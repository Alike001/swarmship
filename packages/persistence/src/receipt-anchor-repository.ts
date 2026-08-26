import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import { updateReceiptAnchorAttempt } from "./receipt-anchor-attempt.js";
import { receiptEvidenceMatchesRelease } from "./receipt-anchor-guard.js";
import {
  receiptAnchorAttemptSchema,
  receiptEvidenceSchema,
  type ReceiptAnchorAttempt,
} from "./receipt-anchor-model.js";
import {
  nextReceiptAnchorAttempt,
  receiptAnchorTransition,
  safeReceiptAnchorSummary,
  saveReceiptAnchorTransition,
} from "./receipt-anchor-transition.js";
import { validateApprovedRelease } from "./release-guard.js";
import { recordWitnessRejection } from "./receipt-witness-rejection.js";
import type {
  ReceiptAnchorOutcomeInput,
  ReceiptAnchorPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
  WitnessRejectedInput,
} from "./types.js";

export class ReceiptAnchorRepository {
  constructor(private readonly database: Database) {}

  async recordPrepared(
    input: ReceiptAnchorPreparedInput,
  ): Promise<ReleaseTransitionRow> {
    const attempt = receiptAnchorAttemptSchema.parse(input.attempt);
    const evidence = receiptEvidenceSchema.parse(input.evidence);
    const summary = safeReceiptAnchorSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["deployed_unverified"],
        false,
      );
      if (
        !receiptEvidenceMatchesRelease(evidence, current) ||
        attempt.proofRoot !== evidence.receiptRoot ||
        input.command.actor !== "witness" ||
        input.command.event !== "witness_confirmed" ||
        input.command.evidenceRef !== evidence.receiptRoot
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The Witness receipt does not match the verified deployment.",
        );
      }
      const result = receiptAnchorTransition(current, input);
      return saveReceiptAnchorTransition({
        attempt,
        current,
        evidence,
        input,
        result,
        summary,
        transaction,
      });
    });
  }

  async recordRejected(
    input: WitnessRejectedInput,
  ): Promise<ReleaseTransitionRow> {
    return recordWitnessRejection(this.database, input);
  }

  async markBroadcasting(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<ReceiptAnchorAttempt> {
    return updateReceiptAnchorAttempt(this.database, {
      leaseToken,
      nowUnixSeconds,
      releaseId,
      update: (attempt) => {
        if (attempt.kind !== "prepared" || attempt.status !== "prepared") {
          throw new PersistenceError(
            "transition_rejected",
            "The receipt anchor is not ready to broadcast.",
          );
        }
        return { ...attempt, status: "broadcasting" };
      },
      workerId,
    });
  }

  async markSubmitted(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<ReceiptAnchorAttempt> {
    return updateReceiptAnchorAttempt(this.database, {
      leaseToken,
      nowUnixSeconds,
      releaseId,
      requireUnexpired: false,
      update: (attempt) => {
        if (attempt.kind !== "prepared" || attempt.status !== "broadcasting") {
          throw new PersistenceError(
            "transition_rejected",
            "The receipt anchor is not awaiting a transaction hash.",
          );
        }
        return { ...attempt, status: "submitted", transactionHash };
      },
      workerId,
    });
  }

  async recordOutcome(
    input: ReceiptAnchorOutcomeInput,
  ): Promise<ReleaseTransitionRow> {
    const summary = safeReceiptAnchorSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["anchoring_receipt", "reconciliation_required"],
        false,
      );
      const evidence = receiptEvidenceSchema.safeParse(current.receiptEvidence);
      const attempt = receiptAnchorAttemptSchema.safeParse(
        current.receiptAnchorAttempt,
      );
      if (
        !evidence.success ||
        !attempt.success ||
        !receiptEvidenceMatchesRelease(evidence.data, current) ||
        attempt.data.proofRoot !== evidence.data.receiptRoot ||
        input.command.actor !== "witness" ||
        input.command.evidenceRef !== evidence.data.receiptRoot
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The stored receipt anchor does not match the verified deployment.",
        );
      }
      const result = receiptAnchorTransition(current, input);
      return saveReceiptAnchorTransition({
        attempt: nextReceiptAnchorAttempt(attempt.data, input.command.event),
        current,
        evidence: evidence.data,
        input,
        result,
        summary,
        transaction,
      });
    });
  }
}
