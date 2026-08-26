import type { Model, Runner } from "@openai/agents";
import {
  AgentRuntimeError,
  createSwarmShipAgents,
  proposeAgentTransition,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import type {
  PreparedStylusDeployment,
  StylusDeploymentConfirmation,
  StylusDeploymentReconciliation,
} from "@swarmship/chain";
import type {
  DeploymentAttempt,
  StylusDeploymentResult,
  StylusVerificationResult,
} from "@swarmship/deployer";
import {
  PersistenceError,
  type DeploymentRepository,
  type LeaseRepository,
  type ReleaseRow,
} from "@swarmship/persistence";

import {
  runDeploymentOperation,
  type DeploymentOperationResult,
} from "./deployment-operation.js";
import { startLeaseHeartbeat } from "./lease-heartbeat.js";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer" | "renew">;
type DeploymentStore = Pick<
  DeploymentRepository,
  | "getAuthorizedDigest"
  | "markObserved"
  | "markReconciledObserved"
  | "markRunning"
  | "markVerified"
  | "recordOutcome"
  | "recordPrepared"
>;

export type DeploymentProcessorDependencies = {
  confirm(
    transactionHash: `0x${string}`,
    contractAddress: `0x${string}`,
    release: ReleaseRow,
  ): Promise<StylusDeploymentConfirmation>;
  deploy(
    release: ReleaseRow,
    nowUnixSeconds: number,
  ): Promise<StylusDeploymentResult>;
  deployments: DeploymentStore;
  heartbeatIntervalMs?: number;
  leaseSeconds: number;
  leases: LeaseStore;
  model: Model;
  nowUnixSeconds?: () => number;
  prepareArtifact(
    release: ReleaseRow,
    nowUnixSeconds: number,
  ): Promise<`0x${string}`>;
  prepareChain(): Promise<PreparedStylusDeployment>;
  reconcile(
    input: {
      nonce: number;
      requiredObservationBlock: bigint;
      sender: `0x${string}`;
      startBlock: bigint;
    },
    release: ReleaseRow,
  ): Promise<StylusDeploymentReconciliation>;
  retrySeconds: number;
  runner?: Runner;
  verify(
    release: ReleaseRow,
    transactionHash: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<StylusVerificationResult>;
  validateChain(prepared: PreparedStylusDeployment): Promise<boolean>;
  workerId: string;
};

export type DeploymentProcessorResult =
  | { status: "idle" }
  | { event: string; releaseId: string; status: "processed" }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

const unavailableTool = async (): Promise<never> => {
  throw new Error("This deployment step cannot use that agent tool.");
};

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError || error instanceof PersistenceError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "deployment_unavailable",
    message: "The guarded Stylus deployment could not complete this step.",
  };
}

export async function processOneDeployment(
  dependencies: DeploymentProcessorDependencies,
): Promise<DeploymentProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["approved_not_deployed", "deploying", "reconciliation_required"],
    ["deployment"],
  );
  if (lease === null) return { status: "idle" };
  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  let operation: DeploymentOperationResult | null = null;
  let preparedAttempt: DeploymentAttempt | null = null;
  const heartbeat = startLeaseHeartbeat({
    ...(dependencies.heartbeatIntervalMs === undefined
      ? {}
      : { intervalMs: dependencies.heartbeatIntervalMs }),
    leaseSeconds: dependencies.leaseSeconds,
    leases: dependencies.leases,
    releaseId: lease.release.id,
    token: lease.token,
    workerId: dependencies.workerId,
  });
  let heartbeatStopped = false;
  const executors: AgentToolExecutors = {
    readIndependentEvidence: unavailableTool,
    renderTaskRegistry: unavailableTool,
    requestGuardedDeployment: async (context) => {
      if (context.releaseId !== lease.release.id) {
        throw new Error("The Deployment Agent selected the wrong release.");
      }
      operation = await runDeploymentOperation({
        confirm: (transactionHash, contractAddress) =>
          dependencies.confirm(transactionHash, contractAddress, lease.release),
        deploy: () => dependencies.deploy(lease.release, nowUnixSeconds),
        deployments: dependencies.deployments,
        lease,
        nowUnixSeconds,
        prepareArtifact: () =>
          dependencies.prepareArtifact(lease.release, nowUnixSeconds),
        prepareChain: dependencies.prepareChain,
        reconcile: (input) => dependencies.reconcile(input, lease.release),
        verify: (transactionHash) =>
          dependencies.verify(lease.release, transactionHash, nowUnixSeconds),
        validateChain: dependencies.validateChain,
        workerId: dependencies.workerId,
      });
      preparedAttempt = operation.preparedAttempt;
      return operation.toolResult;
    },
    runReleaseVerification: unavailableTool,
  };

  try {
    const snapshot = {
      state: lease.release.state,
      version: lease.release.version,
      reconciliation: lease.release.reconciliationKind,
    };
    const result = await runSelectedAgent({
      agents: createSwarmShipAgents({ executors, model: dependencies.model }),
      releaseId: lease.release.id,
      snapshot,
      prompt:
        "Run exactly one guarded Rust Stylus deployment or reconciliation step for this approved release.",
      ...(dependencies.runner === undefined
        ? {}
        : { runner: dependencies.runner }),
    });
    if (
      result.role !== "deployment" ||
      result.toolRecord.role !== "deployment" ||
      operation === null
    ) {
      throw new AgentRuntimeError(
        "invalid_tool_execution",
        "The Deployment Agent did not run the guarded Stylus operation.",
      );
    }
    const command = proposeAgentTransition({
      result,
      snapshot,
      nowUnixSeconds,
    });
    if (command === null) {
      throw new AgentRuntimeError(
        "transition_rejected",
        "The Deployment Agent did not produce a deployment transition.",
      );
    }
    await heartbeat.stop();
    heartbeatStopped = true;
    if (preparedAttempt !== null) {
      await dependencies.deployments.recordPrepared({
        attempt: preparedAttempt,
        command,
        leaseToken: lease.token,
        nowUnixSeconds,
        releaseId: lease.release.id,
        summary: result.output.summary,
        workerId: dependencies.workerId,
      });
    } else {
      await dependencies.deployments.recordOutcome({
        command,
        leaseToken: lease.token,
        nowUnixSeconds,
        releaseId: lease.release.id,
        summary: result.output.summary,
        workerId: dependencies.workerId,
      });
    }
    return {
      event: command.event,
      releaseId: lease.release.id,
      status: "processed",
    };
  } catch (caught) {
    let error = caught;
    if (!heartbeatStopped) {
      try {
        await heartbeat.stop();
      } catch (heartbeatError) {
        error = heartbeatError;
      }
    }
    if (error instanceof PersistenceError && error.code === "lease_lost") {
      return { releaseId: lease.release.id, status: "lease_lost" };
    }
    const safeError = safeWorkerError(error);
    try {
      await dependencies.leases.defer(
        lease.release.id,
        dependencies.workerId,
        lease.token,
        safeError,
        dependencies.retrySeconds,
      );
    } catch (deferError) {
      if (
        deferError instanceof PersistenceError &&
        deferError.code === "lease_lost"
      ) {
        return { releaseId: lease.release.id, status: "lease_lost" };
      }
      throw deferError;
    }
    return {
      code: safeError.code,
      releaseId: lease.release.id,
      status: "deferred",
    };
  }
}
