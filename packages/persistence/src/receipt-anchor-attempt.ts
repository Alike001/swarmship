import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import { receiptEvidenceMatchesRelease } from "./receipt-anchor-guard.js";
import {
  receiptAnchorAttemptSchema,
  receiptEvidenceSchema,
  type ReceiptAnchorAttempt,
} from "./receipt-anchor-model.js";
import { validateApprovedRelease } from "./release-guard.js";
import type { ReleaseRow } from "./types.js";

type UpdateReceiptAnchorAttemptInput = {
  leaseToken: string;
  nowUnixSeconds: number;
  releaseId: string;
  requireUnexpired?: boolean;
  update(attempt: ReceiptAnchorAttempt): ReceiptAnchorAttempt;
  workerId: string;
};

export async function updateReceiptAnchorAttempt(
  database: Database,
  input: UpdateReceiptAnchorAttemptInput,
): Promise<ReceiptAnchorAttempt> {
  return database.begin(async (transaction) => {
    const [current] = await transaction<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${input.releaseId}
    `;
    if (current === undefined) {
      throw new PersistenceError("release_not_found", "Release not found.");
    }
    await validateApprovedRelease(
      current,
      input.nowUnixSeconds,
      ["anchoring_receipt"],
      input.requireUnexpired ?? true,
    );
    const evidence = receiptEvidenceSchema.safeParse(current.receiptEvidence);
    const parsed = receiptAnchorAttemptSchema.safeParse(
      current.receiptAnchorAttempt,
    );
    if (
      !evidence.success ||
      !parsed.success ||
      !receiptEvidenceMatchesRelease(evidence.data, current)
    ) {
      throw new PersistenceError(
        "transition_rejected",
        "The stored receipt attempt is malformed or stale.",
      );
    }
    const attempt = receiptAnchorAttemptSchema.parse(input.update(parsed.data));
    const changed = await transaction`
      UPDATE releases
      SET receipt_anchor_attempt = ${transaction.json(attempt)}
      WHERE id = ${input.releaseId}
        AND version = ${current.version}
        AND lease_owner = ${input.workerId}
        AND lease_token = ${input.leaseToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    if (changed.length === 0) {
      throw new PersistenceError(
        "lease_lost",
        "This worker no longer owns the release lease.",
      );
    }
    return attempt;
  });
}
