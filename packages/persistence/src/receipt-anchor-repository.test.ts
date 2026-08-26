import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { LeaseRepository } from "./lease-repository.js";
import {
  createDeployedReceiptRelease,
  RECEIPT_TEST_ANCHOR_TX,
  RECEIPT_TEST_DEPLOYMENT_TX,
  RECEIPT_TEST_NOW,
  RECEIPT_TEST_RELAYER,
} from "./receipt-anchor-repository.fixture.js";
import { ReceiptAnchorRepository } from "./receipt-anchor-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";

describe("ReceiptAnchorRepository", () => {
  const leases = new LeaseRepository(testDatabase);
  const receipts = new ReceiptAnchorRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function prepare() {
    const ready = await createDeployedReceiptRelease();
    const lease = await leases.claimNext("witness-worker", 60, [
      "deployed_unverified",
    ]);
    if (lease === null) throw new Error("Expected Witness lease.");
    await receipts.recordPrepared({
      attempt: {
        kind: "prepared",
        nonce: 9,
        proofRoot: ready.evidence.receiptRoot,
        sender: RECEIPT_TEST_RELAYER,
        startBlock: "500",
        status: "prepared",
        transactionHash: null,
        version: 1,
      },
      command: {
        actor: "witness",
        event: "witness_confirmed",
        evidenceRef: ready.evidence.receiptRoot,
        expectedVersion: 7,
      },
      evidence: ready.evidence,
      leaseToken: lease.token,
      nowUnixSeconds: RECEIPT_TEST_NOW + 2,
      releaseId: ready.releaseId,
      summary: "Witness matched the exact approved deployment.",
      workerId: "witness-worker",
    });
    return ready;
  }

  it("persists the canonical receipt and all pre-broadcast identifiers", async () => {
    const ready = await prepare();
    expect(await releases.get(ready.releaseId)).toMatchObject({
      receiptAnchorAttempt: {
        nonce: 9,
        proofRoot: ready.evidence.receiptRoot,
        sender: RECEIPT_TEST_RELAYER,
        startBlock: "500",
        status: "prepared",
      },
      receiptEvidence: ready.evidence,
      state: "anchoring_receipt",
      version: 8,
    });
  });

  it("records submission and reaches verified only on confirmed evidence", async () => {
    const ready = await prepare();
    const lease = await leases.claimNext("witness-worker", 60, [
      "anchoring_receipt",
    ]);
    if (lease === null) throw new Error("Expected receipt-anchor lease.");
    await receipts.markBroadcasting(
      ready.releaseId,
      "witness-worker",
      lease.token,
      RECEIPT_TEST_NOW + 3,
    );
    await receipts.markSubmitted(
      ready.releaseId,
      "witness-worker",
      lease.token,
      RECEIPT_TEST_ANCHOR_TX,
      RECEIPT_TEST_NOW + 3,
    );
    await receipts.recordOutcome({
      command: {
        actor: "witness",
        event: "receipt_anchor_confirmed",
        evidenceRef: ready.evidence.receiptRoot,
        expectedVersion: 8,
      },
      leaseToken: lease.token,
      nowUnixSeconds: RECEIPT_TEST_NOW + 3,
      releaseId: ready.releaseId,
      summary: "Both RPC views confirmed the HERŌ receipt root.",
      workerId: "witness-worker",
    });
    expect(await releases.get(ready.releaseId)).toMatchObject({
      receiptAnchorAttempt: {
        status: "confirmed",
        transactionHash: RECEIPT_TEST_ANCHOR_TX,
      },
      state: "verified",
      version: 9,
    });
  });

  it("moves unknown writes into receipt-only reconciliation", async () => {
    const ready = await prepare();
    const lease = await leases.claimNext("witness-worker", 60, [
      "anchoring_receipt",
    ]);
    if (lease === null) throw new Error("Expected receipt-anchor lease.");
    await receipts.markBroadcasting(
      ready.releaseId,
      "witness-worker",
      lease.token,
      RECEIPT_TEST_NOW + 3,
    );
    await receipts.recordOutcome({
      command: {
        actor: "witness",
        event: "receipt_anchor_unknown",
        evidenceRef: ready.evidence.receiptRoot,
        expectedVersion: 8,
      },
      leaseToken: lease.token,
      nowUnixSeconds: RECEIPT_TEST_NOW + 3,
      releaseId: ready.releaseId,
      summary: "The receipt anchor requires reconciliation.",
      workerId: "witness-worker",
    });
    expect(await releases.get(ready.releaseId)).toMatchObject({
      receiptAnchorAttempt: { status: "unknown" },
      reconciliationKind: "receipt_anchor",
      state: "reconciliation_required",
    });
  });

  it("records mismatched Witness data without advancing", async () => {
    const ready = await createDeployedReceiptRelease();
    const lease = await leases.claimNext("witness-worker", 60, [
      "deployed_unverified",
    ]);
    if (lease === null) throw new Error("Expected Witness lease.");
    await receipts.recordRejected({
      command: {
        actor: "witness",
        event: "witness_rejected",
        evidenceRef: RECEIPT_TEST_DEPLOYMENT_TX,
        expectedVersion: 7,
      },
      leaseToken: lease.token,
      nowUnixSeconds: RECEIPT_TEST_NOW + 2,
      releaseId: ready.releaseId,
      retrySeconds: 60,
      summary: "Independent chain evidence did not match.",
      workerId: "witness-worker",
    });
    expect(await releases.get(ready.releaseId)).toMatchObject({
      receiptEvidence: null,
      safeError: { code: "witness_mismatch" },
      state: "deployed_unverified",
      version: 8,
    });
  });

  it("rejects a receipt root or deployment identity that changed", async () => {
    const ready = await createDeployedReceiptRelease();
    const lease = await leases.claimNext("witness-worker", 60, [
      "deployed_unverified",
    ]);
    if (lease === null) throw new Error("Expected Witness lease.");
    await expect(
      receipts.recordPrepared({
        attempt: {
          kind: "prepared",
          nonce: 9,
          proofRoot: `0x${"9".repeat(64)}`,
          sender: RECEIPT_TEST_RELAYER,
          startBlock: "500",
          status: "prepared",
          transactionHash: null,
          version: 1,
        },
        command: {
          actor: "witness",
          event: "witness_confirmed",
          evidenceRef: `0x${"9".repeat(64)}`,
          expectedVersion: 7,
        },
        evidence: ready.evidence,
        leaseToken: lease.token,
        nowUnixSeconds: RECEIPT_TEST_NOW + 2,
        releaseId: ready.releaseId,
        summary: "Tampered receipt.",
        workerId: "witness-worker",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
  });
});
