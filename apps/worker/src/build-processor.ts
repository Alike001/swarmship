import type { Model, Runner } from "@openai/agents";
import {
  AgentRuntimeError,
  createSwarmShipAgents,
  proposeAgentTransition,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import {
  BuildRendererError,
  renderTaskRegistry,
  type BuildEvidenceV1,
} from "@swarmship/builder";
import {
  PersistenceError,
  type BuildRepository,
  type LeaseRepository,
} from "@swarmship/persistence";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer">;
type BuildStore = Pick<BuildRepository, "record">;

export type BuildProcessorDependencies = {
  builds: BuildStore;
  leaseSeconds: number;
  leases: LeaseStore;
  model: Model;
  nowUnixSeconds?: () => number;
  retrySeconds: number;
  runner?: Runner;
  workerId: string;
};

export type BuildProcessorResult =
  | { status: "idle" }
  | { releaseId: string; status: "processed" }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

const unavailableTool = async (): Promise<never> => {
  throw new Error("This build step cannot use that agent tool.");
};

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (
    error instanceof AgentRuntimeError ||
    error instanceof BuildRendererError
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "worker_error",
    message: "The release worker could not complete this step.",
  };
}

export async function processOneBuild(
  dependencies: BuildProcessorDependencies,
): Promise<BuildProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["specified", "verification_failed"],
  );
  if (lease === null) return { status: "idle" };
  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  let rendered: BuildEvidenceV1 | null = null;

  const executors: AgentToolExecutors = {
    readIndependentEvidence: unavailableTool,
    requestGuardedDeployment: unavailableTool,
    runReleaseVerification: unavailableTool,
    renderTaskRegistry: async (context) => {
      if (
        context.releaseId !== lease.release.id ||
        lease.release.specification === null
      ) {
        throw new BuildRendererError(
          "invalid_specification",
          "The build release has no accepted specification.",
        );
      }
      rendered = await renderTaskRegistry(
        lease.release.specification,
        nowUnixSeconds,
      );
      return {
        status: "rendered",
        evidenceRef: rendered.evidenceRef,
        sourceHash: rendered.sourceHash,
        testInputHash: rendered.testInputHash,
      };
    },
  };

  try {
    const snapshot = {
      state: lease.release.state,
      version: lease.release.version,
      reconciliation: lease.release.reconciliationKind,
    };
    const agents = createSwarmShipAgents({
      executors,
      model: dependencies.model,
    });
    const result = await runSelectedAgent({
      agents,
      releaseId: lease.release.id,
      snapshot,
      prompt:
        "Render the accepted fixed task registry and its deterministic test inputs.",
      ...(dependencies.runner === undefined
        ? {}
        : { runner: dependencies.runner }),
    });
    if (result.role !== "build" || rendered === null) {
      throw new AgentRuntimeError(
        "invalid_tool_execution",
        "The Build Agent did not produce deterministic evidence.",
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
        "The Build Agent did not produce a state transition.",
      );
    }
    await dependencies.builds.record({
      command,
      evidence: rendered,
      leaseToken: lease.token,
      nowUnixSeconds,
      releaseId: lease.release.id,
      summary: result.output.summary,
      workerId: dependencies.workerId,
    });
    return { releaseId: lease.release.id, status: "processed" };
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
