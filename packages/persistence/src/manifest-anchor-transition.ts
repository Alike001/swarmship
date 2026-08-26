import { applyReleaseTransition } from "@swarmship/domain/release";

import type { TransactionDatabase } from "./database.js";
import { PersistenceError } from "./errors.js";
import {
  manifestAnchorAttemptSchema,
  type ManifestAnchorAttempt,
} from "./manifest-anchor-model.js";
import type {
  ManifestAnchorOutcomeInput,
  ManifestAnchorPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export function safeManifestAnchorSummary(summary: string): string {
  const value = summary.trim();
  if (value.length < 1 || value.length > 600) {
    throw new PersistenceError(
      "transition_rejected",
      "The manifest anchor summary is missing or too long.",
    );
  }
  return value;
}

export function manifestAnchorTransition(
  current: ReleaseRow,
  input: ManifestAnchorOutcomeInput,
) {
  const result = applyReleaseTransition(
    {
      state: current.state,
      version: current.version,
      reconciliation: current.reconciliationKind,
    },
    input.command,
  );
  if (!result.success) {
    throw new PersistenceError("transition_rejected", result.error.message);
  }
  return result;
}

export function nextManifestAnchorAttempt(
  attempt: ManifestAnchorAttempt,
  event: ManifestAnchorOutcomeInput["command"]["event"],
): ManifestAnchorAttempt | null {
  if (
    event === "manifest_anchor_reverted" ||
    event === "manifest_anchor_reconciled_missing"
  ) {
    return null;
  }
  const status =
    event === "manifest_anchor_confirmed" ||
    event === "manifest_anchor_reconciled_present"
      ? "confirmed"
      : "unknown";
  return manifestAnchorAttemptSchema.parse({ ...attempt, status });
}

export async function saveManifestAnchorTransition(input: {
  attempt: ManifestAnchorAttempt | null;
  current: ReleaseRow;
  input: ManifestAnchorPreparedInput | ManifestAnchorOutcomeInput;
  result: ReturnType<typeof manifestAnchorTransition>;
  summary: string;
  transaction: TransactionDatabase;
}): Promise<ReleaseTransitionRow> {
  const { attempt, current, result, summary, transaction } = input;
  const updated = await transaction`
    UPDATE releases
    SET state = ${result.snapshot.state},
        version = ${result.snapshot.version},
        reconciliation_kind = ${result.snapshot.reconciliation},
        manifest_anchor_attempt = ${attempt === null ? null : transaction.json(attempt)},
        safe_error = NULL,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = ${input.input.releaseId}
      AND version = ${current.version}
      AND lease_owner = ${input.input.workerId}
      AND lease_token = ${input.input.leaseToken}
      AND lease_expires_at > clock_timestamp()
    RETURNING id
  `;
  if (updated.length === 0) {
    throw new PersistenceError(
      "lease_lost",
      "This worker no longer owns the release lease.",
    );
  }
  const [transition] = await transaction<ReleaseTransitionRow[]>`
    INSERT INTO release_transitions (
      release_id, version_before, version_after, actor, event,
      from_state, to_state, evidence_ref, effects, tool_name,
      safe_summary, deterministic_result
    ) VALUES (
      ${input.input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
      ${result.record.actor}, ${result.record.event}, ${result.record.from},
      ${result.record.to}, ${result.record.evidenceRef},
      ${transaction.json(result.record.effects)}, ${"request_guarded_deployment"},
      ${summary}, ${transaction.json({
        proofRoot: result.record.evidenceRef,
        status: attempt?.status ?? "retryable",
      })}
    )
    RETURNING *
  `;
  if (transition === undefined) {
    throw new Error("Manifest anchor transition insert returned no row.");
  }
  return transition;
}
