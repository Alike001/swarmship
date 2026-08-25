import { createHash } from "node:crypto";

import type { Runner } from "@openai/agents";

import {
  AgentRuntimeError,
  extractAcceptedSpecification,
  proposeAgentTransition,
  runSelectedAgent,
  type SwarmShipAgents,
} from "@swarmship/agents";
import {
  PersistenceError,
  type LeaseRepository,
  type SpecificationRepository,
} from "@swarmship/persistence";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer">;
type SpecificationStore = Pick<SpecificationRepository, "record">;

export type SpecificationProcessorDependencies = {
  agents: SwarmShipAgents;
  leaseSeconds: number;
  leases: LeaseStore;
  nowUnixSeconds?: () => number;
  retrySeconds: number;
  runner?: Runner;
  specifications: SpecificationStore;
  workerId: string;
};

export type SpecificationProcessorResult =
  | { status: "idle" }
  | {
      decision: "accepted" | "needs_input";
      releaseId: string;
      status: "processed";
    }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

function evidenceRef(value: unknown): `0x${string}` {
  const digest = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return `0x${digest}`;
}

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "worker_error",
    message: "The release worker could not complete this step.",
  };
}

export async function processOneSpecification(
  dependencies: SpecificationProcessorDependencies,
): Promise<SpecificationProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["created"],
  );
  if (lease === null) return { status: "idle" };

  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  try {
    const snapshot = {
      state: lease.release.state,
      version: lease.release.version,
      reconciliation: lease.release.reconciliationKind,
    };
    const agentInput = {
      agents: dependencies.agents,
      releaseId: lease.release.id,
      snapshot,
      prompt: lease.release.originalRequest,
      ...(dependencies.runner === undefined
        ? {}
        : { runner: dependencies.runner }),
    };
    const result = await runSelectedAgent(agentInput);
    if (result.role !== "specification") {
      throw new AgentRuntimeError(
        "invalid_snapshot",
        "The release selected the wrong agent role.",
      );
    }

    const specification =
      result.output.decision === "accepted"
        ? extractAcceptedSpecification(result.output, nowUnixSeconds)
        : null;
    const ref = evidenceRef({
      decision: result.output.decision,
      missingFields: [...result.output.missingFields].sort(),
      role: result.role,
      specification,
      summary: result.output.summary,
      version: 1,
    });
    const command = proposeAgentTransition({
      result,
      snapshot,
      specificationEvidenceRef: ref,
      nowUnixSeconds,
    });
    if (command === null) {
      throw new AgentRuntimeError(
        "transition_rejected",
        "The Specification Agent did not produce a state transition.",
      );
    }

    await dependencies.specifications.record({
      command,
      leaseToken: lease.token,
      missingFields: [...result.output.missingFields].sort(),
      releaseId: lease.release.id,
      specification,
      summary: result.output.summary,
      workerId: dependencies.workerId,
    });
    return {
      decision: result.output.decision,
      releaseId: lease.release.id,
      status: "processed",
    };
  } catch (error) {
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
