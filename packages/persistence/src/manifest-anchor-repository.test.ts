import { renderTaskRegistry } from "@swarmship/builder";
import { toReleaseManifestTypedData } from "@swarmship/domain/release";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ApprovalRepository } from "./approval-repository.js";
import { LeaseRepository } from "./lease-repository.js";
import { ManifestAnchorRepository } from "./manifest-anchor-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";
import { passedVerificationEvidence } from "./verification-evidence.fixture.js";

const NOW = 1_800_000_000;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;
const RELAYER = "0x0000000000000000000000000000000000000004" as const;

describe("ManifestAnchorRepository", () => {
  const approvals = new ApprovalRepository(testDatabase);
  const anchors = new ManifestAnchorRepository(testDatabase);
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function createApprovedRelease() {
    const owner = privateKeyToAccount(generatePrivateKey());
    const specification = {
      contractFamily: "agent-task-registry-v1" as const,
      owner: owner.address,
      permittedSender: SENDER,
      permittedReceiver: RECEIVER,
      maxHandoffs: 5,
      expiry: 2_000_000_000,
    };
    const created = await releases.create({ originalRequest: "Registry" });
    const build = await renderTaskRegistry(specification, NOW);
    const verification = passedVerificationEvidence(build.evidenceRef);
    await testDatabase`
      UPDATE releases
      SET state = 'awaiting_approval',
          version = 3,
          specification = ${testDatabase.json(specification)},
          build_evidence = ${testDatabase.json(build)},
          verification_evidence = ${testDatabase.json(verification)},
          updated_at = to_timestamp(${NOW})
      WHERE id = ${created.release.id}
    `;
    const request = await approvals.getRequest(created.release.id, NOW + 1);
    const signature = await owner.signTypedData(
      toReleaseManifestTypedData(request.manifest),
    );
    await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId: created.release.id,
      signature,
    });
    return {
      approvalExpiry: request.manifest.approvalExpiry,
      digest: request.digest,
      releaseId: created.release.id,
    };
  }

  async function startPreparedAnchor() {
    const approved = await createApprovedRelease();
    const lease = await leases.claimNext("deploy-worker", 60, ["approved"]);
    if (lease === null) throw new Error("Expected approved lease.");
    const attempt = {
      kind: "prepared" as const,
      nonce: 7,
      proofRoot: approved.digest,
      sender: RELAYER,
      startBlock: "123",
      status: "prepared" as const,
      transactionHash: null,
      version: 1 as const,
    };
    await anchors.recordPrepared({
      attempt,
      command: {
        actor: "deployment",
        event: "manifest_anchor_started",
        evidenceRef: approved.digest,
        expectedVersion: 4,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 2,
      releaseId: approved.releaseId,
      summary: "Prepared the exact approved HERŌ root.",
      workerId: "deploy-worker",
    });
    return { ...approved, attempt };
  }

  it("persists preparation before any broadcast", async () => {
    const { digest, releaseId } = await startPreparedAnchor();

    expect(await releases.get(releaseId)).toMatchObject({
      manifestAnchorAttempt: {
        proofRoot: digest,
        status: "prepared",
        transactionHash: null,
      },
      state: "anchoring_manifest",
      version: 5,
    });
  });

  it("records broadcasting, submission, and confirmation safely", async () => {
    const { digest, releaseId } = await startPreparedAnchor();
    const lease = await leases.claimNext("deploy-worker", 60, [
      "anchoring_manifest",
    ]);
    if (lease === null) throw new Error("Expected anchor lease.");
    await anchors.markBroadcasting(
      releaseId,
      "deploy-worker",
      lease.token,
      NOW + 3,
    );
    const transactionHash = `0x${"8".repeat(64)}` as const;
    await anchors.markSubmitted(
      releaseId,
      "deploy-worker",
      lease.token,
      transactionHash,
      NOW + 3,
    );
    await anchors.recordOutcome({
      command: {
        actor: "deployment",
        event: "manifest_anchor_confirmed",
        evidenceRef: digest,
        expectedVersion: 5,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 3,
      releaseId,
      summary: "HERŌ confirmed the approved manifest root.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(releaseId)).toMatchObject({
      manifestAnchorAttempt: {
        proofRoot: digest,
        status: "confirmed",
        transactionHash,
      },
      state: "approved_not_deployed",
      version: 6,
    });
  });

  it("moves an unknown outcome into reconciliation without rebroadcasting", async () => {
    const { digest, releaseId } = await startPreparedAnchor();
    const lease = await leases.claimNext("deploy-worker", 60, [
      "anchoring_manifest",
    ]);
    if (lease === null) throw new Error("Expected anchor lease.");
    await anchors.markBroadcasting(
      releaseId,
      "deploy-worker",
      lease.token,
      NOW + 3,
    );
    await anchors.recordOutcome({
      command: {
        actor: "deployment",
        event: "manifest_anchor_unknown",
        evidenceRef: digest,
        expectedVersion: 5,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 3,
      releaseId,
      summary: "The HERŌ write outcome needs reconciliation.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(releaseId)).toMatchObject({
      manifestAnchorAttempt: { status: "unknown", transactionHash: null },
      reconciliationKind: "manifest_anchor",
      state: "reconciliation_required",
      version: 6,
    });
  });

  it("blocks a new expired broadcast but completes an attempt already sent", async () => {
    const { approvalExpiry, digest, releaseId } = await startPreparedAnchor();
    const lease = await leases.claimNext("deploy-worker", 60, [
      "anchoring_manifest",
    ]);
    if (lease === null) throw new Error("Expected anchor lease.");

    await expect(
      anchors.markBroadcasting(
        releaseId,
        "deploy-worker",
        lease.token,
        approvalExpiry,
      ),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    await anchors.markBroadcasting(
      releaseId,
      "deploy-worker",
      lease.token,
      approvalExpiry - 1,
    );
    await anchors.markSubmitted(
      releaseId,
      "deploy-worker",
      lease.token,
      `0x${"7".repeat(64)}`,
      approvalExpiry + 1,
    );
    await anchors.recordOutcome({
      command: {
        actor: "deployment",
        event: "manifest_anchor_confirmed",
        evidenceRef: digest,
        expectedVersion: 5,
      },
      leaseToken: lease.token,
      nowUnixSeconds: approvalExpiry + 1,
      releaseId,
      summary: "Completed the already authorized HERŌ write.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(releaseId)).toMatchObject({
      state: "approved_not_deployed",
    });
  });

  it("rejects a prepared root that differs from the owner approval", async () => {
    const { releaseId } = await createApprovedRelease();
    const lease = await leases.claimNext("deploy-worker", 60, ["approved"]);
    if (lease === null) throw new Error("Expected approved lease.");

    await expect(
      anchors.recordPrepared({
        attempt: {
          kind: "prepared",
          nonce: 7,
          proofRoot: `0x${"9".repeat(64)}`,
          sender: RELAYER,
          startBlock: "123",
          status: "prepared",
          transactionHash: null,
          version: 1,
        },
        command: {
          actor: "deployment",
          event: "manifest_anchor_started",
          evidenceRef: `0x${"9".repeat(64)}`,
          expectedVersion: 4,
        },
        leaseToken: lease.token,
        nowUnixSeconds: NOW + 2,
        releaseId,
        summary: "Tampered root.",
        workerId: "deploy-worker",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    expect(await releases.get(releaseId)).toMatchObject({
      manifestAnchorAttempt: null,
      state: "approved",
      version: 4,
    });
  });
});
