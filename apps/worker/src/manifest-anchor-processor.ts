import type { Model, Runner } from "@openai/agents";
import {
  AgentRuntimeError,
  createSwarmShipAgents,
  proposeAgentTransition,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  HeroAnchorReconciliation,
  HeroProofRecord,
  PreparedHeroAnchor,
} from "@swarmship/chain";
import {
  PersistenceError,
  type LeaseRepository,
  type ManifestAnchorAttempt,
  type ManifestAnchorRepository,
} from "@swarmship/persistence";

import { startLeaseHeartbeat } from "./lease-heartbeat.js";
import {
  runManifestAnchorOperation,
  type ManifestAnchorOperationResult,
} from "./manifest-anchor-operation.js";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer" | "renew">;
type AnchorStore = Pick<
  ManifestAnchorRepository,
  | "getAuthorizedRoot"
  | "markBroadcasting"
  | "markSubmitted"
  | "recordOutcome"
  | "recordPrepared"
>;

export type ManifestAnchorProcessorDependencies = {
  anchors: AnchorStore;
  broadcast(prepared: PreparedHeroAnchor): Promise<HeroAnchorBroadcast>;
  confirm(
    proofRoot: string,
    transactionHash: `0x${string}`,
  ): Promise<HeroAnchorConfirmation>;
  heartbeatIntervalMs?: number;
  leaseSeconds: number;
  leases: LeaseStore;
  model: Model;
  nowUnixSeconds?: () => number;
  prepare(proofRoot: string): Promise<HeroAnchorPreparation>;
  reconcile(input: {
    proofRoot: string;
    requiredObservationBlock: bigint;
    startBlock: bigint;
  }): Promise<HeroAnchorReconciliation>;
  retrySeconds: number;
  runner?: Runner;
  verify(proofRoot: string): Promise<HeroProofRecord>;
  workerId: string;
};

export type ManifestAnchorProcessorResult =
  | { status: "idle" }
  | { event: string; releaseId: string; status: "processed" }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

const unavailableTool = async (): Promise<never> => {
  throw new Error("This manifest anchor step cannot use that agent tool.");
};

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError || error instanceof PersistenceError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "manifest_anchor_unavailable",
    message: "The HERŌ manifest anchor could not complete this step.",
  };
}

export async function processOneManifestAnchor(
  dependencies: ManifestAnchorProcessorDependencies,
): Promise<ManifestAnchorProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["approved", "anchoring_manifest", "reconciliation_required"],
    ["manifest_anchor"],
  );
  if (lease === null) return { status: "idle" };
  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  let operation: ManifestAnchorOperationResult | null = null;
  let preparedAttempt: ManifestAnchorAttempt | null = null;
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
      operation = await runManifestAnchorOperation({
        anchors: dependencies.anchors,
        broadcast: dependencies.broadcast,
        confirm: dependencies.confirm,
        lease,
        nowUnixSeconds,
        prepare: dependencies.prepare,
        reconcile: dependencies.reconcile,
        verify: dependencies.verify,
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
        "Run exactly one guarded HERŌ manifest-anchor or reconciliation step for this approved release.",
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
        "The Deployment Agent did not run the guarded manifest operation.",
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
        "The Deployment Agent did not produce a manifest transition.",
      );
    }
    await heartbeat.stop();
    heartbeatStopped = true;
    if (preparedAttempt !== null) {
      await dependencies.anchors.recordPrepared({
        attempt: preparedAttempt,
        command,
        leaseToken: lease.token,
        nowUnixSeconds,
        releaseId: lease.release.id,
        summary: result.output.summary,
        workerId: dependencies.workerId,
      });
    } else {
      await dependencies.anchors.recordOutcome({
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
