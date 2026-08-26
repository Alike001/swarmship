import { renderTaskRegistry } from "@swarmship/builder";
import type { DeploymentAttempt } from "@swarmship/deployer";
import { toReleaseManifestTypedData } from "@swarmship/domain/release";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ApprovalRepository } from "./approval-repository.js";
import { DeploymentRepository } from "./deployment-repository.js";
import { LeaseRepository } from "./lease-repository.js";
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
const CONTRACT = "0x0000000000000000000000000000000000000005" as const;
const TRANSACTION = `0x${"6".repeat(64)}` as const;

describe("DeploymentRepository", () => {
  const approvals = new ApprovalRepository(testDatabase);
  const deployments = new DeploymentRepository(testDatabase);
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function createReadyRelease() {
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
      SET state = 'awaiting_approval', version = 3,
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
    await testDatabase`
      UPDATE releases SET state = 'approved_not_deployed', version = 5
      WHERE id = ${created.release.id}
    `;
    const attempt: DeploymentAttempt = {
      approvalDigest: request.digest,
      artifactHash: verification.artifactHash!,
      constructor: {
        expiry: specification.expiry,
        maxHandoffs: specification.maxHandoffs,
        owner: specification.owner,
        permittedReceiver: specification.permittedReceiver,
        permittedSender: specification.permittedSender,
      },
      contractAddress: null,
      nonce: 8,
      sender: RELAYER,
      startBlock: "123",
      status: "prepared",
      transactionHash: null,
      verificationStatus: "pending",
      version: 1,
    };
    return {
      approvalExpiry: request.manifest.approvalExpiry,
      attempt,
      digest: request.digest,
      releaseId: created.release.id,
    };
  }

  async function prepare() {
    const ready = await createReadyRelease();
    const lease = await leases.claimNext("deploy-worker", 60, [
      "approved_not_deployed",
    ]);
    if (lease === null) throw new Error("Expected deployment lease.");
    await deployments.recordPrepared({
      attempt: ready.attempt,
      command: {
        actor: "deployment",
        event: "deployment_started",
        evidenceRef: ready.digest,
        expectedVersion: 5,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 2,
      releaseId: ready.releaseId,
      summary: "Prepared the exact approved Stylus deployment.",
      workerId: "deploy-worker",
    });
    return ready;
  }

  it("persists every pre-broadcast identifier before deployment", async () => {
    const ready = await prepare();

    expect(await releases.get(ready.releaseId)).toMatchObject({
      deploymentAttempt: {
        artifactHash: ready.attempt.artifactHash,
        nonce: 8,
        sender: RELAYER,
        startBlock: "123",
        status: "prepared",
      },
      state: "deploying",
      version: 6,
    });
  });

  it("requires observed identifiers and verification before success", async () => {
    const ready = await prepare();
    const lease = await leases.claimNext("deploy-worker", 60, ["deploying"]);
    if (lease === null) throw new Error("Expected deployment lease.");
    await deployments.markRunning(
      ready.releaseId,
      "deploy-worker",
      lease.token,
      NOW + 3,
    );
    await deployments.markObserved(
      ready.releaseId,
      "deploy-worker",
      lease.token,
      TRANSACTION,
      CONTRACT,
      NOW + 3,
    );
    await expect(
      deployments.recordOutcome({
        command: {
          actor: "deployment",
          event: "deployment_observed",
          evidenceRef: ready.digest,
          expectedVersion: 6,
        },
        leaseToken: lease.token,
        nowUnixSeconds: NOW + 3,
        releaseId: ready.releaseId,
        summary: "Unverified result.",
        workerId: "deploy-worker",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    await deployments.markVerified(
      ready.releaseId,
      "deploy-worker",
      lease.token,
      NOW + 3,
    );
    await deployments.recordOutcome({
      command: {
        actor: "deployment",
        event: "deployment_observed",
        evidenceRef: ready.digest,
        expectedVersion: 6,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 3,
      releaseId: ready.releaseId,
      summary: "Observed and independently verified the deployed registry.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(ready.releaseId)).toMatchObject({
      deploymentAttempt: {
        contractAddress: CONTRACT,
        status: "confirmed",
        transactionHash: TRANSACTION,
        verificationStatus: "passed",
      },
      state: "deployed_unverified",
      version: 7,
    });
  });

  it("blocks a new run after approval expiry", async () => {
    const ready = await prepare();
    const lease = await leases.claimNext("deploy-worker", 60, ["deploying"]);
    if (lease === null) throw new Error("Expected deployment lease.");

    await expect(
      deployments.markRunning(
        ready.releaseId,
        "deploy-worker",
        lease.token,
        ready.approvalExpiry,
      ),
    ).rejects.toMatchObject({ code: "transition_rejected" });
  });

  it("moves a running unknown outcome to reconciliation", async () => {
    const ready = await prepare();
    const lease = await leases.claimNext("deploy-worker", 60, ["deploying"]);
    if (lease === null) throw new Error("Expected deployment lease.");
    await deployments.markRunning(
      ready.releaseId,
      "deploy-worker",
      lease.token,
      NOW + 3,
    );
    await deployments.recordOutcome({
      command: {
        actor: "deployment",
        event: "deployment_unknown",
        evidenceRef: ready.digest,
        expectedVersion: 6,
      },
      leaseToken: lease.token,
      nowUnixSeconds: NOW + 3,
      releaseId: ready.releaseId,
      summary: "The deployment outcome requires reconciliation.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(ready.releaseId)).toMatchObject({
      deploymentAttempt: { status: "unknown" },
      reconciliationKind: "deployment",
      state: "reconciliation_required",
    });

    const reconciliationLease = await leases.claimNext(
      "deploy-worker",
      60,
      ["reconciliation_required"],
      ["deployment"],
    );
    if (reconciliationLease === null) {
      throw new Error("Expected reconciliation lease.");
    }
    await deployments.markReconciledObserved(
      ready.releaseId,
      "deploy-worker",
      reconciliationLease.token,
      TRANSACTION,
      CONTRACT,
      NOW + 4,
    );
    await deployments.recordOutcome({
      command: {
        actor: "deployment",
        event: "deployment_verification_rejected",
        evidenceRef: ready.digest,
        expectedVersion: 7,
      },
      leaseToken: reconciliationLease.token,
      nowUnixSeconds: NOW + 4,
      releaseId: ready.releaseId,
      summary: "The deployed bytes did not reproduce from approved source.",
      workerId: "deploy-worker",
    });

    expect(await releases.get(ready.releaseId)).toMatchObject({
      deploymentAttempt: null,
      reconciliationKind: null,
      state: "approved_not_deployed",
    });
    const [transition] = await testDatabase<
      { deterministicResult: Record<string, unknown> }[]
    >`SELECT deterministic_result FROM release_transitions
      WHERE release_id = ${ready.releaseId} AND event = 'deployment_verification_rejected'`;
    expect(transition?.deterministicResult).toMatchObject({
      contractAddress: CONTRACT,
      status: "verification_rejected",
      transactionHash: TRANSACTION,
    });
  });
});
