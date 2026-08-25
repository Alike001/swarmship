import type {
  ReconciliationKind,
  ReleaseActor,
  ReleaseEvent,
  ReleaseTransitionCommand,
  ReleaseTransitionEffect,
  TaskRegistrySpecV1,
} from "@swarmship/domain/release";
import type { ReleaseState } from "@swarmship/domain";

export type ReleaseRow = {
  id: string;
  publicId: string;
  originalRequest: string;
  state: ReleaseState;
  version: number;
  reconciliationKind: ReconciliationKind | null;
  specification: TaskRegistrySpecV1 | null;
  specificationSummary: string | null;
  missingFields: string[] | null;
  buildEvidence: unknown | null;
  manifestApproval: unknown | null;
  safeError: unknown | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  retryCount: number;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ReleaseTransitionRow = {
  id: string;
  releaseId: string;
  versionBefore: number;
  versionAfter: number;
  actor: ReleaseActor;
  event: ReleaseEvent;
  fromState: ReleaseState;
  toState: ReleaseState;
  evidenceRef: `0x${string}`;
  effects: ReleaseTransitionEffect[];
  toolName: string | null;
  safeSummary: string | null;
  deterministicResult: unknown | null;
  createdAt: Date;
};

export type IdempotencyInput = {
  callerScope: string;
  key: string;
  operation: string;
  requestHash: `0x${string}`;
};

export type CreateReleaseInput = {
  originalRequest: string;
  idempotency?: IdempotencyInput;
};

export type CreateReleaseResult = {
  created: boolean;
  release: ReleaseRow;
};

export type ReleaseLease = {
  release: ReleaseRow;
  token: string;
};

export type DeferredReleaseError = {
  code: string;
  message: string;
};

export type SpecificationResultInput = {
  command: ReleaseTransitionCommand;
  leaseToken: string;
  missingFields: string[];
  releaseId: string;
  specification: TaskRegistrySpecV1 | null;
  summary: string;
  workerId: string;
};
