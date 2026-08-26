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
  HeroDeploymentInspection,
  HeroProofRecord,
  PreparedHeroAnchor,
  StylusWitnessObservation,
} from "@swarmship/chain";
import type { StylusVerificationResult } from "@swarmship/deployer";
import {
  PersistenceError,
  type LeaseRepository,
  type ReceiptAnchorAttempt,
  type ReceiptAnchorRepository,
  type ReceiptEvidenceV1,
  type ReleaseRow,
} from "@swarmship/persistence";

import { startLeaseHeartbeat } from "./lease-heartbeat.js";
import {
  runWitnessOperation,
  type WitnessOperationResult,
} from "./witness-operation.js";

type LeaseStore = Pick<LeaseRepository, "claimNext" | "defer" | "renew">;
type ReceiptStore = Pick<
  ReceiptAnchorRepository,
  | "markBroadcasting"
  | "markSubmitted"
  | "recordOutcome"
  | "recordPrepared"
  | "recordRejected"
>;

export type WitnessProcessorDependencies = {
  broadcast(prepared: PreparedHeroAnchor): Promise<HeroAnchorBroadcast>;
  confirm(
    proofRoot: string,
    transactionHash: `0x${string}`,
  ): Promise<HeroAnchorConfirmation>;
  heartbeatIntervalMs?: number;
  inspectOfficial(): Promise<HeroDeploymentInspection>;
  inspectWitness(): Promise<HeroDeploymentInspection>;
  leaseSeconds: number;
  leases: LeaseStore;
  model: Model;
  nowUnixSeconds?: () => number;
  observeDeployment(release: ReleaseRow): Promise<StylusWitnessObservation>;
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
  retrySeconds: number;
  runner?: Runner;
  verifyManifestWitness(proofRoot: string): Promise<HeroProofRecord>;
  verifyReceiptOfficial(proofRoot: string): Promise<HeroProofRecord>;
  verifyReceiptWitness(proofRoot: string): Promise<HeroProofRecord>;
  verifySource(release: ReleaseRow): Promise<StylusVerificationResult>;
  workerId: string;
};

export type WitnessProcessorResult =
  | { status: "idle" }
  | { event: string; releaseId: string; status: "processed" }
  | { code: string; releaseId: string; status: "deferred" }
  | { releaseId: string; status: "lease_lost" };

const unavailableTool = async (): Promise<never> => {
  throw new Error("This Witness step cannot use that agent tool.");
};

function safeWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError || error instanceof PersistenceError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "witness_unavailable",
    message: "Independent release evidence could not complete this step.",
  };
}

export async function processOneWitness(
  dependencies: WitnessProcessorDependencies,
): Promise<WitnessProcessorResult> {
  const lease = await dependencies.leases.claimNext(
    dependencies.workerId,
    dependencies.leaseSeconds,
    ["deployed_unverified", "anchoring_receipt", "reconciliation_required"],
    ["receipt_anchor"],
  );
  if (lease === null) return { status: "idle" };
  const nowUnixSeconds =
    dependencies.nowUnixSeconds?.() ?? Math.floor(Date.now() / 1_000);
  let operation: WitnessOperationResult | null = null;
  let preparedAttempt: ReceiptAnchorAttempt | null = null;
  let preparedEvidence: ReceiptEvidenceV1 | null = null;
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
    readIndependentEvidence: async (context) => {
      if (context.releaseId !== lease.release.id) {
        throw new Error("The Witness Agent selected the wrong release.");
      }
      operation = await runWitnessOperation({
        broadcast: dependencies.broadcast,
        confirm: dependencies.confirm,
        inspectOfficial: dependencies.inspectOfficial,
        inspectWitness: dependencies.inspectWitness,
        lease,
        nowUnixSeconds,
        observeDeployment: () => dependencies.observeDeployment(lease.release),
        prepare: dependencies.prepare,
        receipts: dependencies.receipts,
        reconcileOfficial: dependencies.reconcileOfficial,
        reconcileWitness: dependencies.reconcileWitness,
        verifyManifestWitness: dependencies.verifyManifestWitness,
        verifyReceiptOfficial: dependencies.verifyReceiptOfficial,
        verifyReceiptWitness: dependencies.verifyReceiptWitness,
        verifySource: () => dependencies.verifySource(lease.release),
        workerId: dependencies.workerId,
      });
      preparedAttempt = operation.preparedAttempt;
      preparedEvidence = operation.preparedEvidence;
      return operation.toolResult;
    },
    renderTaskRegistry: unavailableTool,
    requestGuardedDeployment: unavailableTool,
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
        "Run exactly one independent deployment-witness or receipt-anchor reconciliation step for this release.",
      ...(dependencies.runner === undefined
        ? {}
        : { runner: dependencies.runner }),
    });
    if (
      result.role !== "witness" ||
      result.toolRecord.role !== "witness" ||
      operation === null
    ) {
      throw new AgentRuntimeError(
        "invalid_tool_execution",
        "The Witness Agent did not run the independent evidence operation.",
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
        "The Witness Agent did not produce a receipt transition.",
      );
    }
    await heartbeat.stop();
    heartbeatStopped = true;
    if (command.event === "witness_rejected") {
      await dependencies.receipts.recordRejected({
        command,
        leaseToken: lease.token,
        nowUnixSeconds,
        releaseId: lease.release.id,
        retrySeconds: dependencies.retrySeconds,
        summary: result.output.summary,
        workerId: dependencies.workerId,
      });
    } else if (preparedAttempt !== null && preparedEvidence !== null) {
      await dependencies.receipts.recordPrepared({
        attempt: preparedAttempt,
        command,
        evidence: preparedEvidence,
        leaseToken: lease.token,
        nowUnixSeconds,
        releaseId: lease.release.id,
        summary: result.output.summary,
        workerId: dependencies.workerId,
      });
    } else {
      await dependencies.receipts.recordOutcome({
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
