import type { WitnessToolResult } from "@swarmship/agents";
import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  HeroAnchorReconciliation,
  HeroDeploymentInspection,
  HeroProofRecord,
  PreparedHeroAnchor,
  StylusWitnessObservation,
} from "@swarmship/chain";
import type { StylusVerificationResult } from "@swarmship/deployer";
import type {
  ReceiptAnchorAttempt,
  ReceiptEvidenceV1,
  ReleaseLease,
} from "@swarmship/persistence";

import {
  assertStoredReceiptEvidence,
  matchingProofs,
  prepareWitnessEvidence,
  storedReceiptAttempt,
  witnessResult,
} from "./witness-evidence.js";

type ReceiptStore = {
  markBroadcasting(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<ReceiptAnchorAttempt>;
  markSubmitted(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<ReceiptAnchorAttempt>;
};

export type WitnessOperationDependencies = {
  broadcast(prepared: PreparedHeroAnchor): Promise<HeroAnchorBroadcast>;
  confirm(
    proofRoot: string,
    transactionHash: `0x${string}`,
  ): Promise<HeroAnchorConfirmation>;
  inspectOfficial(): Promise<HeroDeploymentInspection>;
  inspectWitness(): Promise<HeroDeploymentInspection>;
  lease: ReleaseLease;
  nowUnixSeconds: number;
  observeDeployment(): Promise<StylusWitnessObservation>;
  prepare(proofRoot: string): Promise<HeroAnchorPreparation>;
  receipts: ReceiptStore;
  reconcileOfficial(input: {
    proofRoot: string;
    requiredObservationBlock: bigint;
    startBlock: bigint;
  }): Promise<HeroAnchorReconciliation>;
  reconcileWitness(input: {
    proofRoot: string;
    requiredObservationBlock: bigint;
    startBlock: bigint;
  }): Promise<HeroAnchorReconciliation>;
  verifyManifestWitness(proofRoot: string): Promise<HeroProofRecord>;
  verifyReceiptOfficial(proofRoot: string): Promise<HeroProofRecord>;
  verifyReceiptWitness(proofRoot: string): Promise<HeroProofRecord>;
  verifySource(): Promise<StylusVerificationResult>;
  workerId: string;
};

export type WitnessOperationResult = {
  preparedAttempt: ReceiptAnchorAttempt | null;
  preparedEvidence: ReceiptEvidenceV1 | null;
  toolResult: WitnessToolResult;
};

async function confirmedResult(
  dependencies: WitnessOperationDependencies,
  confirmation: HeroAnchorConfirmation,
  root: `0x${string}`,
): Promise<WitnessOperationResult> {
  if (confirmation.status === "reverted") {
    return witnessResult("mismatch", "receipt_anchor_reverted", root);
  }
  if (confirmation.status === "unknown") {
    return witnessResult("unknown", "receipt_anchor_unknown", root);
  }
  const witness = await dependencies.verifyReceiptWitness(root);
  return matchingProofs(confirmation.proof, witness)
    ? witnessResult("verified", "receipt_anchor_confirmed", root)
    : witnessResult("unknown", "receipt_anchor_unknown", root);
}

async function continuePreparedOperation(
  dependencies: WitnessOperationDependencies,
  attempt: Extract<ReceiptAnchorAttempt, { kind: "prepared" }>,
): Promise<WitnessOperationResult> {
  const root = attempt.proofRoot as `0x${string}`;
  if (attempt.status === "broadcasting" || attempt.status === "unknown") {
    return witnessResult("unknown", "receipt_anchor_unknown", root);
  }
  if (attempt.status === "reverted") {
    return witnessResult("mismatch", "receipt_anchor_reverted", root);
  }
  if (attempt.status === "submitted" || attempt.status === "confirmed") {
    if (attempt.transactionHash === null) {
      return witnessResult("unknown", "receipt_anchor_unknown", root);
    }
    return confirmedResult(
      dependencies,
      await dependencies.confirm(root, attempt.transactionHash),
      root,
    );
  }

  await dependencies.receipts.markBroadcasting(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    dependencies.nowUnixSeconds,
  );
  let broadcast: HeroAnchorBroadcast;
  try {
    broadcast = await dependencies.broadcast({
      kind: "ready",
      nonce: attempt.nonce,
      proofRoot: root,
      sender: attempt.sender,
      startBlock: BigInt(attempt.startBlock),
    });
  } catch {
    return witnessResult("unknown", "receipt_anchor_unknown", root);
  }
  if (broadcast.kind === "already_anchored") {
    const witness = await dependencies.verifyReceiptWitness(root);
    return matchingProofs(broadcast.proof, witness)
      ? witnessResult("verified", "receipt_anchor_confirmed", root)
      : witnessResult("unknown", "receipt_anchor_unknown", root);
  }
  await dependencies.receipts.markSubmitted(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    broadcast.transactionHash,
    dependencies.nowUnixSeconds,
  );
  return confirmedResult(
    dependencies,
    await dependencies.confirm(root, broadcast.transactionHash),
    root,
  );
}

async function continueOperation(
  dependencies: WitnessOperationDependencies,
): Promise<WitnessOperationResult> {
  const attempt = storedReceiptAttempt(dependencies.lease);
  assertStoredReceiptEvidence(dependencies.lease);
  if (attempt.kind === "existing") {
    const [official, witness] = await Promise.all([
      dependencies.verifyReceiptOfficial(attempt.proofRoot),
      dependencies.verifyReceiptWitness(attempt.proofRoot),
    ]);
    return matchingProofs(official, witness)
      ? witnessResult("verified", "receipt_anchor_confirmed", attempt.proofRoot)
      : witnessResult("unknown", "receipt_anchor_unknown", attempt.proofRoot);
  }
  return continuePreparedOperation(dependencies, attempt);
}

async function reconcileOperation(
  dependencies: WitnessOperationDependencies,
): Promise<WitnessOperationResult> {
  const attempt = storedReceiptAttempt(dependencies.lease);
  assertStoredReceiptEvidence(dependencies.lease);
  if (attempt.kind === "existing") {
    const [official, witness] = await Promise.all([
      dependencies.verifyReceiptOfficial(attempt.proofRoot),
      dependencies.verifyReceiptWitness(attempt.proofRoot),
    ]);
    return witnessResult(
      "verified",
      matchingProofs(official, witness)
        ? "receipt_anchor_reconciled_present"
        : "receipt_anchor_reconciled_missing",
      attempt.proofRoot,
    );
  }
  const startBlock = BigInt(attempt.startBlock);
  const input = {
    proofRoot: attempt.proofRoot,
    startBlock,
    requiredObservationBlock: startBlock + 2n,
  };
  const [official, witness] = await Promise.all([
    dependencies.reconcileOfficial(input),
    dependencies.reconcileWitness(input),
  ]);
  if (
    official.status === "inconclusive" ||
    witness.status === "inconclusive" ||
    official.status !== witness.status
  ) {
    throw new Error("The receipt anchor outcome is still inconclusive.");
  }
  if (
    official.status === "present" &&
    witness.status === "present" &&
    !matchingProofs(official.proof, witness.proof)
  ) {
    throw new Error("The receipt anchor RPC views disagree.");
  }
  return witnessResult(
    "verified",
    official.status === "present"
      ? "receipt_anchor_reconciled_present"
      : "receipt_anchor_reconciled_missing",
    attempt.proofRoot,
  );
}

export async function runWitnessOperation(
  dependencies: WitnessOperationDependencies,
): Promise<WitnessOperationResult> {
  const { release } = dependencies.lease;
  if (release.state === "deployed_unverified") {
    return prepareWitnessEvidence(dependencies);
  }
  if (release.state === "anchoring_receipt") {
    return continueOperation(dependencies);
  }
  if (
    release.state === "reconciliation_required" &&
    release.reconciliationKind === "receipt_anchor"
  ) {
    return reconcileOperation(dependencies);
  }
  throw new Error("This release has no Witness operation to run.");
}
