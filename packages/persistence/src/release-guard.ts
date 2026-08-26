import {
  createReleaseManifest,
  hashReleaseManifest,
  manifestApprovalSchema,
  verifyManifestApproval,
  type ManifestApprovalV1,
  type ReleaseManifestV1,
} from "@swarmship/domain/release";
import type { ReleaseState } from "@swarmship/domain";

import { PersistenceError } from "./errors.js";
import type { ReleaseRow } from "./types.js";

const APPROVAL_WINDOW_SECONDS = 24 * 60 * 60;

function manifestFromEvidence(
  current: ReleaseRow,
  releaseVersion: number,
  approvalExpiry: number,
): ReleaseManifestV1 {
  const verification = current.verificationEvidence;
  if (
    current.specification === null ||
    current.buildEvidence === null ||
    verification === null ||
    verification.status !== "passed" ||
    verification.artifactHash === null
  ) {
    throw new PersistenceError(
      "transition_rejected",
      "This release has no complete passing evidence.",
    );
  }
  return createReleaseManifest({
    approvalExpiry,
    artifactHash: verification.artifactHash,
    publicId: current.publicId,
    releaseVersion,
    sourceHash: current.buildEvidence.sourceHash,
    specification: current.specification,
    testEvidenceHash: verification.testEvidenceHash,
    toolchainHash: verification.toolchainHash,
  });
}

export function pendingManifest(current: ReleaseRow): ReleaseManifestV1 {
  if (current.state !== "awaiting_approval" || current.specification === null) {
    throw new PersistenceError(
      "transition_rejected",
      "This release is not ready for owner approval.",
    );
  }
  const verifiedAt = Math.floor(current.updatedAt.getTime() / 1_000);
  return manifestFromEvidence(
    current,
    current.version,
    Math.min(
      current.specification.expiry,
      verifiedAt + APPROVAL_WINDOW_SECONDS,
    ),
  );
}

export function storedApproval(current: ReleaseRow): ManifestApprovalV1 | null {
  if (current.manifestApproval === null) return null;
  const parsed = manifestApprovalSchema.safeParse(current.manifestApproval);
  if (!parsed.success) {
    throw new PersistenceError(
      "transition_rejected",
      "The stored release approval is inconsistent and needs repair.",
    );
  }
  return parsed.data;
}

export async function validateApprovedRelease(
  current: ReleaseRow,
  nowUnixSeconds: number,
  allowedStates: readonly ReleaseState[],
  requireUnexpired = true,
): Promise<ManifestApprovalV1> {
  if (!allowedStates.includes(current.state)) {
    throw new PersistenceError(
      "transition_rejected",
      "This release is not at an approved chain checkpoint.",
    );
  }
  const approval = storedApproval(current);
  if (approval === null) {
    throw new PersistenceError(
      "transition_rejected",
      "This release has no owner approval.",
    );
  }
  const nonce = Number(approval.manifest.nonce);
  if (!Number.isSafeInteger(nonce)) {
    throw new PersistenceError(
      "transition_rejected",
      "The stored release approval nonce is invalid.",
    );
  }
  const rebuilt = manifestFromEvidence(
    current,
    nonce,
    approval.manifest.approvalExpiry,
  );
  const verificationTime = requireUnexpired
    ? nowUnixSeconds
    : Math.min(nowUnixSeconds, approval.manifest.approvalExpiry - 1);
  const verified = await verifyManifestApproval(
    rebuilt,
    approval.signature,
    verificationTime,
  );
  if (
    !verified.success ||
    hashReleaseManifest(rebuilt) !== approval.digest ||
    verified.data.signer !== approval.signer ||
    approval.approvedAt > nowUnixSeconds
  ) {
    throw new PersistenceError(
      "transition_rejected",
      "The stored owner approval no longer matches this release.",
    );
  }
  return approval;
}
