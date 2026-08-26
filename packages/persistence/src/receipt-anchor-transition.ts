import { applyReleaseTransition } from "@swarmship/domain/release";

import type { TransactionDatabase } from "./database.js";
import { PersistenceError } from "./errors.js";
import {
  receiptAnchorAttemptSchema,
  type ReceiptAnchorAttempt,
  type ReceiptEvidenceV1,
} from "./receipt-anchor-model.js";
import type {
  ReceiptAnchorOutcomeInput,
  ReceiptAnchorPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export function safeReceiptAnchorSummary(summary: string): string {
  const value = summary.trim();
  if (value.length < 1 || value.length > 600) {
    throw new PersistenceError(
      "transition_rejected",
      "The Witness summary is missing or too long.",
    );
  }
  return value;
}

export function receiptAnchorTransition(
  current: ReleaseRow,
  input: ReceiptAnchorPreparedInput | ReceiptAnchorOutcomeInput,
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

export function nextReceiptAnchorAttempt(
  attempt: ReceiptAnchorAttempt,
  event: ReceiptAnchorOutcomeInput["command"]["event"],
): ReceiptAnchorAttempt | null {
  if (
    event === "receipt_anchor_reverted" ||
    event === "receipt_anchor_reconciled_missing"
  ) {
    return null;
  }
  const status =
    event === "receipt_anchor_confirmed" ||
    event === "receipt_anchor_reconciled_present"
      ? "confirmed"
      : "unknown";
  return receiptAnchorAttemptSchema.parse({ ...attempt, status });
}

export async function saveReceiptAnchorTransition(input: {
  attempt: ReceiptAnchorAttempt | null;
  current: ReleaseRow;
  evidence: ReceiptEvidenceV1;
  input: ReceiptAnchorPreparedInput | ReceiptAnchorOutcomeInput;
  result: ReturnType<typeof receiptAnchorTransition>;
  summary: string;
  transaction: TransactionDatabase;
}): Promise<ReleaseTransitionRow> {
  const { attempt, current, evidence, result, summary, transaction } = input;
  const updated = await transaction`
    UPDATE releases
    SET state = ${result.snapshot.state},
        version = ${result.snapshot.version},
        reconciliation_kind = ${result.snapshot.reconciliation},
        receipt_evidence = ${transaction.json(evidence)},
        receipt_anchor_attempt = ${attempt === null ? null : transaction.json(attempt)},
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
      ${transaction.json(result.record.effects)}, ${"read_independent_evidence"},
      ${summary}, ${transaction.json({
        contractAddress: evidence.receipt.deployedAddress,
        deploymentTransaction: evidence.receipt.deploymentTransaction,
        officialChainId: evidence.officialChainId,
        receiptRoot: evidence.receiptRoot,
        status: attempt?.status ?? "retryable",
        witnessChainId: evidence.witnessChainId,
      })}
    )
    RETURNING *
  `;
  if (transition === undefined) {
    throw new Error("Receipt anchor transition insert returned no row.");
  }
  return transition;
}
