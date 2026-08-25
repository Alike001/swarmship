import type { Model, Runner } from "@openai/agents";
import {
  AgentRuntimeError,
  createSwarmShipAgents,
  proposeAgentTransition,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import {
  PersistenceError,
  type LeaseRepository,
  type VerificationRepository,
} from "@swarmship/persistence";
import {
  VerifierError,
  verifyTaskRegistry,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";

import { startLeaseHeartbeat } from "./lease-heartbeat.js";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer" | "renew">;
type VerificationStore = Pick<VerificationRepository, "record">;

export type VerificationProcessorDependencies = {
  heartbeatIntervalMs?: number;
  leaseSeconds: number;
  leases: LeaseStore;
  model: Model;
  nowUnixSeconds?: () => number;
  retrySeconds: number;
  runner?: Runner;
  verificationRunner?: typeof verifyTaskRegistry;
  verifications: VerificationStore;
  workerId: string;
};

export type VerificationProcessorResult =
  | { status: "idle" }
  | { outcome: "passed" | "failed"; releaseId: string; status: "processed" }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

const unavailableTool = async (): Promise<never> => {
  throw new Error("This verification step cannot use that agent tool.");
};

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError || error instanceof VerifierError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "worker_error",
    message: "The release worker could not complete this step.",
  };
}

export async function processOneVerification(
  dependencies: VerificationProcessorDependencies,
): Promise<VerificationProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["building"],
  );
  if (lease === null) return { status: "idle" };
  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  let evidence: VerificationEvidenceV1 | null = null;
  const verify = dependencies.verificationRunner ?? verifyTaskRegistry;
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
    requestGuardedDeployment: unavailableTool,
    runReleaseVerification: async (context) => {
      if (
        context.releaseId !== lease.release.id ||
        lease.release.specification === null ||
        lease.release.buildEvidence === null
      ) {
        throw new VerifierError(
          "invalid_build_evidence",
          "The release has no accepted build evidence to verify.",
        );
      }
      evidence = await verify(
        lease.release.buildEvidence,
        lease.release.specification,
        nowUnixSeconds,
      );
      return {
        checks: evidence.checks.map((check) => `${check.name}:${check.status}`),
        evidenceRef: evidence.evidenceRef,
        status: evidence.status,
      };
    },
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
        "Run the fixed Rust and Stylus verification plan for the exact persisted build.",
      ...(dependencies.runner === undefined
        ? {}
        : { runner: dependencies.runner }),
    });
    if (
      result.role !== "verification" ||
      result.toolRecord.role !== "verification" ||
      evidence === null
    ) {
      throw new AgentRuntimeError(
        "invalid_tool_execution",
        "The Verification Agent did not produce deterministic evidence.",
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
        "The Verification Agent did not produce a state transition.",
      );
    }
    const outcome = result.toolRecord.result.status;
    if (outcome === "blocked") {
      throw new AgentRuntimeError(
        "transition_rejected",
        "The Verification Agent returned a blocked result with a transition.",
      );
    }
    await heartbeat.stop();
    heartbeatStopped = true;
    await dependencies.verifications.record({
      command,
      evidence,
      leaseToken: lease.token,
      nowUnixSeconds,
      releaseId: lease.release.id,
      summary: result.output.summary,
      workerId: dependencies.workerId,
    });
    return {
      outcome,
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
