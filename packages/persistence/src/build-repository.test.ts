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

const NOW = 1_800_000_000;
const SPEC_EVIDENCE = `0x${"4".repeat(64)}` as const;
const specification = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

describe("BuildRepository", () => {
  const builds = new BuildRepository(testDatabase);
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);
  const specifications = new SpecificationRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function createSpecifiedRelease() {
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
    return { buildLease, releaseId: created.release.id };
  }

  it("atomically stores validated build evidence and transition", async () => {
    const { buildLease, releaseId } = await createSpecifiedRelease();
    const evidence = await renderTaskRegistry(specification, NOW);

    const transition = await builds.record({
      command: {
        actor: "build",
        event: "build_started",
        evidenceRef: evidence.evidenceRef,
        expectedVersion: 1,
      },
      evidence,
      leaseToken: buildLease.token,
      nowUnixSeconds: NOW,
      releaseId,
      summary: "The fixed Rust registry and five test inputs were rendered.",
      workerId: "build-worker",
    });

    expect(transition).toMatchObject({
      deterministicResult: {
        sourceHash: evidence.sourceHash,
        testInputHash: evidence.testInputHash,
      },
      event: "build_started",
      toolName: "render_task_registry",
      toState: "building",
    });
    expect(await releases.get(releaseId)).toMatchObject({
      buildEvidence: {
        evidenceRef: evidence.evidenceRef,
        sourceFiles: expect.any(Array),
        sourceHash: evidence.sourceHash,
        testInputHash: evidence.testInputHash,
      },
      leaseOwner: null,
      state: "building",
      version: 2,
    });
  });

  it("rejects tampered evidence without changing the release", async () => {
    const { buildLease, releaseId } = await createSpecifiedRelease();
    const evidence = await renderTaskRegistry(specification, NOW);

    await expect(
      builds.record({
        command: {
          actor: "build",
          event: "build_started",
          evidenceRef: evidence.evidenceRef,
          expectedVersion: 1,
        },
        evidence: { ...evidence, sourceHash: `0x${"f".repeat(64)}` },
        leaseToken: buildLease.token,
        nowUnixSeconds: NOW,
        releaseId,
        summary: "Claims a mismatched source hash.",
        workerId: "build-worker",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    expect(await releases.get(releaseId)).toMatchObject({
      buildEvidence: null,
      state: "specified",
      version: 1,
    });
  });

  it("rejects output after the build lease expires", async () => {
    const { buildLease, releaseId } = await createSpecifiedRelease();
    const evidence = await renderTaskRegistry(specification, NOW);
    await testDatabase`
      UPDATE releases
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${releaseId}
    `;

    await expect(
      builds.record({
        command: {
          actor: "build",
          event: "build_started",
          evidenceRef: evidence.evidenceRef,
          expectedVersion: 1,
        },
        evidence,
        leaseToken: buildLease.token,
        nowUnixSeconds: NOW,
        releaseId,
        summary: "The fixed Rust registry was rendered.",
        workerId: "build-worker",
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(await releases.get(releaseId)).toMatchObject({
      buildEvidence: null,
      state: "specified",
      version: 1,
    });
  });
});
