import type {
  ReconciliationKind,
  ReleaseActor,
  ReleaseEvent,
  ManifestApprovalV1,
  ReleaseManifestV1,
  ReleaseTransitionCommand,
  ReleaseTransitionEffect,
  TaskRegistrySpecV1,
} from "@swarmship/domain/release";
import type { BuildEvidenceV1 } from "@swarmship/builder";
import type { ReleaseState } from "@swarmship/domain";
import type { VerificationEvidenceV1 } from "@swarmship/verifier";
import type { ManifestAnchorAttempt } from "./manifest-anchor-model.js";

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
  buildEvidence: BuildEvidenceV1 | null;
  verificationEvidence: VerificationEvidenceV1 | null;
  manifestApproval: ManifestApprovalV1 | null;
  manifestAnchorAttempt: ManifestAnchorAttempt | null;
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

export type BuildResultInput = {
  command: ReleaseTransitionCommand;
  evidence: BuildEvidenceV1;
  leaseToken: string;
  nowUnixSeconds: number;
  releaseId: string;
  summary: string;
  workerId: string;
};

export type VerificationResultInput = {
  command: ReleaseTransitionCommand;
  evidence: VerificationEvidenceV1;
  leaseToken: string;
  nowUnixSeconds: number;
  releaseId: string;
  summary: string;
  workerId: string;
};

export type ReleaseApprovalRequest = {
  digest: `0x${string}`;
  manifest: ReleaseManifestV1;
  summary: ReturnType<
    typeof import("@swarmship/domain/release").summarizeReleaseManifest
  >;
};

export type ApproveReleaseInput = {
  expectedVersion: number;
  nowUnixSeconds: number;
  releaseId: string;
  signature: unknown;
};

export type ApproveReleaseResult = {
  approval: ManifestApprovalV1;
  created: boolean;
  release: ReleaseRow;
  transition: ReleaseTransitionRow | null;
};

export type ManifestAnchorPreparedInput = {
  attempt: ManifestAnchorAttempt;
  command: ReleaseTransitionCommand;
  leaseToken: string;
  nowUnixSeconds: number;
  releaseId: string;
  summary: string;
  workerId: string;
};

export type ManifestAnchorOutcomeInput = {
  command: ReleaseTransitionCommand;
  leaseToken: string;
  nowUnixSeconds: number;
  releaseId: string;
  summary: string;
  workerId: string;
};
