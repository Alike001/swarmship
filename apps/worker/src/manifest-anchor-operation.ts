import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  HeroAnchorReconciliation,
  HeroProofRecord,
  PreparedHeroAnchor,
} from "@swarmship/chain";
import type { DeploymentToolResult } from "@swarmship/agents";
import {
  manifestAnchorAttemptSchema,
  type ManifestAnchorAttempt,
  type ReleaseLease,
} from "@swarmship/persistence";

type AnchorStore = {
  getAuthorizedRoot(
    releaseId: string,
    nowUnixSeconds: number,
  ): Promise<`0x${string}`>;
  markBroadcasting(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<ManifestAnchorAttempt>;
  markSubmitted(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<ManifestAnchorAttempt>;
};

export type ManifestAnchorOperationDependencies = {
  anchors: AnchorStore;
  broadcast(prepared: PreparedHeroAnchor): Promise<HeroAnchorBroadcast>;
  confirm(
    proofRoot: string,
    transactionHash: `0x${string}`,
  ): Promise<HeroAnchorConfirmation>;
  lease: ReleaseLease;
  nowUnixSeconds: number;
  prepare(proofRoot: string): Promise<HeroAnchorPreparation>;
  reconcile(input: {
    proofRoot: string;
    requiredObservationBlock: bigint;
    startBlock: bigint;
  }): Promise<HeroAnchorReconciliation>;
  verify(proofRoot: string): Promise<HeroProofRecord>;
  workerId: string;
};

export type ManifestAnchorOperationResult = {
  preparedAttempt: ManifestAnchorAttempt | null;
  toolResult: DeploymentToolResult;
};

function result(
  status: DeploymentToolResult["status"],
  event: DeploymentToolResult["event"],
  evidenceRef: `0x${string}`,
): ManifestAnchorOperationResult {
  return { preparedAttempt: null, toolResult: { status, event, evidenceRef } };
}

function confirmationResult(
  confirmation: HeroAnchorConfirmation,
  root: `0x${string}`,
): ManifestAnchorOperationResult {
  if (confirmation.status === "confirmed") {
    return result("accepted", "manifest_anchor_confirmed", root);
  }
  if (confirmation.status === "reverted") {
    return result("accepted", "manifest_anchor_reverted", root);
  }
  return result("unknown", "manifest_anchor_unknown", root);
}

function storedAttempt(lease: ReleaseLease): ManifestAnchorAttempt {
  return manifestAnchorAttemptSchema.parse(lease.release.manifestAnchorAttempt);
}

async function prepareOperation(
  dependencies: ManifestAnchorOperationDependencies,
): Promise<ManifestAnchorOperationResult> {
  const root = await dependencies.anchors.getAuthorizedRoot(
    dependencies.lease.release.id,
    dependencies.nowUnixSeconds,
  );
  const preparation = await dependencies.prepare(root);
  const attempt: ManifestAnchorAttempt =
    preparation.kind === "already_anchored"
      ? {
          kind: "existing",
          proofRoot: preparation.proof.proofRoot,
          status: "existing",
          submitter: preparation.proof.submitter,
          timestamp: preparation.proof.timestamp.toString(),
          transactionHash: null,
          version: 1,
        }
      : {
          kind: "prepared",
          nonce: preparation.nonce,
          proofRoot: preparation.proofRoot,
          sender: preparation.sender,
          startBlock: preparation.startBlock.toString(),
          status: "prepared",
          transactionHash: null,
          version: 1,
        };
  const validated = manifestAnchorAttemptSchema.parse(attempt);
  return {
    preparedAttempt: validated,
    toolResult: {
      status: "accepted",
      event: "manifest_anchor_started",
      evidenceRef: validated.proofRoot,
    },
  };
}

async function continuePreparedOperation(
  dependencies: ManifestAnchorOperationDependencies,
  attempt: Extract<ManifestAnchorAttempt, { kind: "prepared" }>,
): Promise<ManifestAnchorOperationResult> {
  const root = attempt.proofRoot as `0x${string}`;
  if (attempt.status === "broadcasting" || attempt.status === "unknown") {
    return result("unknown", "manifest_anchor_unknown", root);
  }
  if (attempt.status === "reverted") {
    return result("accepted", "manifest_anchor_reverted", root);
  }
  if (attempt.status === "submitted" || attempt.status === "confirmed") {
    if (attempt.transactionHash === null) {
      return result("unknown", "manifest_anchor_unknown", root);
    }
    return confirmationResult(
      await dependencies.confirm(root, attempt.transactionHash),
      root,
    );
  }

  await dependencies.anchors.markBroadcasting(
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
    return result("unknown", "manifest_anchor_unknown", root);
  }
  if (broadcast.kind === "already_anchored") {
    return result("accepted", "manifest_anchor_confirmed", root);
  }
  await dependencies.anchors.markSubmitted(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    broadcast.transactionHash,
    dependencies.nowUnixSeconds,
  );
  return confirmationResult(
    await dependencies.confirm(root, broadcast.transactionHash),
    root,
  );
}

async function continueOperation(
  dependencies: ManifestAnchorOperationDependencies,
): Promise<ManifestAnchorOperationResult> {
  const attempt = storedAttempt(dependencies.lease);
  if (attempt.kind === "existing") {
    const proof = await dependencies.verify(attempt.proofRoot);
    return proof.anchored && proof.proofRoot === attempt.proofRoot
      ? result("accepted", "manifest_anchor_confirmed", attempt.proofRoot)
      : result("unknown", "manifest_anchor_unknown", attempt.proofRoot);
  }
  return continuePreparedOperation(dependencies, attempt);
}

async function reconcileOperation(
  dependencies: ManifestAnchorOperationDependencies,
): Promise<ManifestAnchorOperationResult> {
  const attempt = storedAttempt(dependencies.lease);
  if (attempt.kind === "existing") {
    const proof = await dependencies.verify(attempt.proofRoot);
    return result(
      "accepted",
      proof.anchored
        ? "manifest_anchor_reconciled_present"
        : "manifest_anchor_reconciled_missing",
      attempt.proofRoot,
    );
  }
  const startBlock = BigInt(attempt.startBlock);
  const reconciliation = await dependencies.reconcile({
    proofRoot: attempt.proofRoot,
    startBlock,
    requiredObservationBlock: startBlock + 2n,
  });
  if (reconciliation.status === "inconclusive") {
    throw new Error("The HERŌ anchor outcome is still inconclusive.");
  }
  return result(
    "accepted",
    reconciliation.status === "present"
      ? "manifest_anchor_reconciled_present"
      : "manifest_anchor_reconciled_missing",
    attempt.proofRoot,
  );
}

export async function runManifestAnchorOperation(
  dependencies: ManifestAnchorOperationDependencies,
): Promise<ManifestAnchorOperationResult> {
  const { release } = dependencies.lease;
  if (release.state === "approved") return prepareOperation(dependencies);
  if (release.state === "anchoring_manifest") {
    return continueOperation(dependencies);
  }
  if (
    release.state === "reconciliation_required" &&
    release.reconciliationKind === "manifest_anchor"
  ) {
    return reconcileOperation(dependencies);
  }
  throw new Error("This release has no manifest anchor operation to run.");
}
