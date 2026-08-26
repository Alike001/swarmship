import type {
  PreparedStylusDeployment,
  StylusDeploymentConfirmation,
  StylusDeploymentReconciliation,
} from "@swarmship/chain";
import {
  deploymentAttemptSchema,
  type DeploymentAttempt,
  type StylusDeploymentResult,
  type StylusVerificationResult,
} from "@swarmship/deployer";
import type { DeploymentToolResult } from "@swarmship/agents";
import type {
  DeploymentRepository,
  ReleaseLease,
} from "@swarmship/persistence";

type DeploymentStore = Pick<
  DeploymentRepository,
  | "getAuthorizedDigest"
  | "markObserved"
  | "markReconciledObserved"
  | "markRunning"
  | "markVerified"
>;

export type DeploymentOperationDependencies = {
  confirm(
    transactionHash: `0x${string}`,
    contractAddress: `0x${string}`,
  ): Promise<StylusDeploymentConfirmation>;
  deploy(): Promise<StylusDeploymentResult>;
  deployments: DeploymentStore;
  lease: ReleaseLease;
  nowUnixSeconds: number;
  prepareArtifact(): Promise<`0x${string}`>;
  prepareChain(): Promise<PreparedStylusDeployment>;
  reconcile(input: {
    nonce: number;
    requiredObservationBlock: bigint;
    sender: `0x${string}`;
    startBlock: bigint;
  }): Promise<StylusDeploymentReconciliation>;
  validateChain(prepared: PreparedStylusDeployment): Promise<boolean>;
  verify(transactionHash: `0x${string}`): Promise<StylusVerificationResult>;
  workerId: string;
};

export type DeploymentOperationResult = {
  preparedAttempt: DeploymentAttempt | null;
  toolResult: DeploymentToolResult;
};

function result(
  status: DeploymentToolResult["status"],
  event: DeploymentToolResult["event"],
  evidenceRef: `0x${string}`,
): DeploymentOperationResult {
  return { preparedAttempt: null, toolResult: { status, event, evidenceRef } };
}

function storedAttempt(lease: ReleaseLease): DeploymentAttempt {
  return deploymentAttemptSchema.parse(lease.release.deploymentAttempt);
}

async function prepareOperation(
  dependencies: DeploymentOperationDependencies,
): Promise<DeploymentOperationResult> {
  const release = dependencies.lease.release;
  const specification = release.specification;
  if (specification === null)
    throw new Error("Approved specification is missing.");
  const approvalDigest = await dependencies.deployments.getAuthorizedDigest(
    release.id,
    dependencies.nowUnixSeconds,
  );
  const [artifactHash, chain] = await Promise.all([
    dependencies.prepareArtifact(),
    dependencies.prepareChain(),
  ]);
  const attempt = deploymentAttemptSchema.parse({
    approvalDigest,
    artifactHash,
    constructor: {
      expiry: specification.expiry,
      maxHandoffs: specification.maxHandoffs,
      owner: specification.owner,
      permittedReceiver: specification.permittedReceiver,
      permittedSender: specification.permittedSender,
    },
    contractAddress: null,
    nonce: chain.nonce,
    sender: chain.sender,
    startBlock: chain.startBlock.toString(),
    status: "prepared",
    transactionHash: null,
    verificationStatus: "pending",
    version: 1,
  });
  return {
    preparedAttempt: attempt,
    toolResult: {
      status: "accepted",
      event: "deployment_started",
      evidenceRef: approvalDigest,
    },
  };
}

async function verifyObserved(
  dependencies: DeploymentOperationDependencies,
  attempt: DeploymentAttempt,
  reconciled: boolean,
): Promise<DeploymentOperationResult> {
  if (attempt.transactionHash === null || attempt.contractAddress === null) {
    return result("unknown", "deployment_unknown", attempt.approvalDigest);
  }
  const confirmation = await dependencies.confirm(
    attempt.transactionHash,
    attempt.contractAddress,
  );
  if (confirmation.status === "reverted") {
    if (reconciled) {
      throw new Error("The reconciled deployment receipt changed status.");
    }
    return result("accepted", "deployment_reverted", attempt.approvalDigest);
  }
  if (confirmation.status !== "confirmed") {
    if (reconciled) {
      throw new Error("The reconciled deployment could not be confirmed.");
    }
    return result("unknown", "deployment_unknown", attempt.approvalDigest);
  }
  const verification = await dependencies.verify(attempt.transactionHash);
  if (verification.status !== "passed") {
    if (reconciled) {
      return result(
        "accepted",
        "deployment_verification_rejected",
        attempt.approvalDigest,
      );
    }
    return result("unknown", "deployment_unknown", attempt.approvalDigest);
  }
  await dependencies.deployments.markVerified(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    dependencies.nowUnixSeconds,
  );
  return result(
    "accepted",
    reconciled ? "deployment_reconciled_present" : "deployment_observed",
    attempt.approvalDigest,
  );
}

async function continueOperation(
  dependencies: DeploymentOperationDependencies,
): Promise<DeploymentOperationResult> {
  const attempt = storedAttempt(dependencies.lease);
  if (attempt.status === "running" || attempt.status === "unknown") {
    return result("unknown", "deployment_unknown", attempt.approvalDigest);
  }
  if (attempt.status === "observed" || attempt.status === "confirmed") {
    return verifyObserved(dependencies, attempt, false);
  }
  const prepared = {
    nonce: attempt.nonce,
    sender: attempt.sender,
    startBlock: BigInt(attempt.startBlock),
  };
  if (!(await dependencies.validateChain(prepared))) {
    return result("accepted", "deployment_reverted", attempt.approvalDigest);
  }
  await dependencies.deployments.markRunning(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    dependencies.nowUnixSeconds,
  );
  const deployment = await dependencies.deploy();
  if (deployment.status !== "observed") {
    return result("unknown", "deployment_unknown", attempt.approvalDigest);
  }
  const observed = await dependencies.deployments.markObserved(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    deployment.transactionHash,
    deployment.contractAddress,
    dependencies.nowUnixSeconds,
  );
  return verifyObserved(dependencies, observed, false);
}

async function reconcileOperation(
  dependencies: DeploymentOperationDependencies,
): Promise<DeploymentOperationResult> {
  const attempt = storedAttempt(dependencies.lease);
  if (attempt.status === "observed" || attempt.status === "confirmed") {
    return verifyObserved(dependencies, attempt, true);
  }
  const startBlock = BigInt(attempt.startBlock);
  const reconciliation = await dependencies.reconcile({
    nonce: attempt.nonce,
    requiredObservationBlock: startBlock + 2n,
    sender: attempt.sender,
    startBlock,
  });
  if (reconciliation.status === "inconclusive") {
    throw new Error("The Stylus deployment outcome is still inconclusive.");
  }
  if (reconciliation.status === "missing") {
    return result(
      "accepted",
      "deployment_reconciled_missing",
      attempt.approvalDigest,
    );
  }
  const observed = await dependencies.deployments.markReconciledObserved(
    dependencies.lease.release.id,
    dependencies.workerId,
    dependencies.lease.token,
    reconciliation.transactionHash,
    reconciliation.contractAddress,
    dependencies.nowUnixSeconds,
  );
  return verifyObserved(dependencies, observed, true);
}

export async function runDeploymentOperation(
  dependencies: DeploymentOperationDependencies,
): Promise<DeploymentOperationResult> {
  const release = dependencies.lease.release;
  if (release.state === "approved_not_deployed") {
    return prepareOperation(dependencies);
  }
  if (release.state === "deploying") return continueOperation(dependencies);
  if (
    release.state === "reconciliation_required" &&
    release.reconciliationKind === "deployment"
  ) {
    return reconcileOperation(dependencies);
  }
  throw new Error("This release has no Stylus deployment operation to run.");
}
