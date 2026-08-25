import { renderTaskRegistry } from "@swarmship/builder";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BuildRepository } from "./build-repository.js";
import { LeaseRepository } from "./lease-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import { SpecificationRepository } from "./specification-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";
import {
  failedVerificationEvidence,
  passedVerificationEvidence,
} from "./verification-evidence.fixture.js";
import { VerificationRepository } from "./verification-repository.js";

const NOW = 1_800_000_000;
const specification = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};
const SPEC_EVIDENCE = `0x${"4".repeat(64)}` as const;

describe("VerificationRepository", () => {
  const builds = new BuildRepository(testDatabase);
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);
  const specifications = new SpecificationRepository(testDatabase);
  const verifications = new VerificationRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function createBuildingRelease() {
    const created = await releases.create({ originalRequest: "Registry" });
    const specificationLease = await leases.claimNext("spec-worker", 60, [
      "created",
    ]);
    if (specificationLease === null) throw new Error("Expected spec lease.");
    await specifications.record({
      command: {
        actor: "specification",
        event: "specification_accepted",
        evidenceRef: SPEC_EVIDENCE,
        expectedVersion: 0,
      },
      leaseToken: specificationLease.token,
      missingFields: [],
      releaseId: created.release.id,
      specification,
      summary: "A bounded registry.",
      workerId: "spec-worker",
    });
    const buildLease = await leases.claimNext("build-worker", 60, [
      "specified",
    ]);
    if (buildLease === null) throw new Error("Expected build lease.");
    const build = await renderTaskRegistry(specification, NOW);
    await builds.record({
      command: {
        actor: "build",
        event: "build_started",
        evidenceRef: build.evidenceRef,
        expectedVersion: 1,
      },
      evidence: build,
      leaseToken: buildLease.token,
      nowUnixSeconds: NOW,
      releaseId: created.release.id,
      summary: "Rendered.",
      workerId: "build-worker",
    });
    const verificationLease = await leases.claimNext("verify-worker", 60, [
      "building",
    ]);
    if (verificationLease === null) throw new Error("Expected verify lease.");
    return { build, releaseId: created.release.id, verificationLease };
  }

  it("atomically stores a validated pass and its transition", async () => {
    const { build, releaseId, verificationLease } =
      await createBuildingRelease();
    const evidence = passedVerificationEvidence(build.evidenceRef);

    const transition = await verifications.record({
      command: {
        actor: "verification",
        event: "verification_passed",
        evidenceRef: evidence.evidenceRef,
        expectedVersion: 2,
      },
      evidence,
      leaseToken: verificationLease.token,
      nowUnixSeconds: NOW,
      releaseId,
      summary: "All four deterministic checks passed.",
      workerId: "verify-worker",
    });

    expect(transition).toMatchObject({
      event: "verification_passed",
      toState: "awaiting_approval",
      toolName: "run_release_verification",
    });
    expect(await releases.get(releaseId)).toMatchObject({
      leaseOwner: null,
      state: "awaiting_approval",
      verificationEvidence: {
        artifactHash: evidence.artifactHash,
        evidenceRef: evidence.evidenceRef,
        status: "passed",
      },
      version: 3,
    });
  });

  it("rejects tampered evidence without changing state", async () => {
    const { build, releaseId, verificationLease } =
      await createBuildingRelease();
    const evidence = passedVerificationEvidence(build.evidenceRef);

    await expect(
      verifications.record({
        command: {
          actor: "verification",
          event: "verification_passed",
          evidenceRef: evidence.evidenceRef,
          expectedVersion: 2,
        },
        evidence: { ...evidence, artifactBase64: "dGFtcGVyZWQ=" },
        leaseToken: verificationLease.token,
        nowUnixSeconds: NOW,
        releaseId,
        summary: "Tampered.",
        workerId: "verify-worker",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    expect(await releases.get(releaseId)).toMatchObject({
      state: "building",
      verificationEvidence: null,
      version: 2,
    });
  });

  it("atomically stores a deterministic failure for a build retry", async () => {
    const { build, releaseId, verificationLease } =
      await createBuildingRelease();
    const evidence = failedVerificationEvidence(build.evidenceRef);

    await verifications.record({
      command: {
        actor: "verification",
        event: "verification_failed",
        evidenceRef: evidence.evidenceRef,
        expectedVersion: 2,
      },
      evidence,
      leaseToken: verificationLease.token,
      nowUnixSeconds: NOW,
      releaseId,
      summary: "Rust formatting failed.",
      workerId: "verify-worker",
    });

    expect(await releases.get(releaseId)).toMatchObject({
      state: "verification_failed",
      verificationEvidence: {
        artifactHash: null,
        status: "failed",
      },
      version: 3,
    });
  });

  it("rejects a result after its lease expires", async () => {
    const { build, releaseId, verificationLease } =
      await createBuildingRelease();
    const evidence = passedVerificationEvidence(build.evidenceRef);
    await testDatabase`
      UPDATE releases
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${releaseId}
    `;

    await expect(
      verifications.record({
        command: {
          actor: "verification",
          event: "verification_passed",
          evidenceRef: evidence.evidenceRef,
          expectedVersion: 2,
        },
        evidence,
        leaseToken: verificationLease.token,
        nowUnixSeconds: NOW,
        releaseId,
        summary: "Late result.",
        workerId: "verify-worker",
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
  });
});
