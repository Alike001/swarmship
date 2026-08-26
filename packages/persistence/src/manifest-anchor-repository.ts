import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import {
  manifestAnchorAttemptSchema,
  type ManifestAnchorAttempt,
} from "./manifest-anchor-model.js";
import {
  manifestAnchorTransition,
  nextManifestAnchorAttempt,
  safeManifestAnchorSummary,
  saveManifestAnchorTransition,
} from "./manifest-anchor-transition.js";
import { validateApprovedRelease } from "./release-guard.js";
import type {
  ManifestAnchorOutcomeInput,
  ManifestAnchorPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export class ManifestAnchorRepository {
  constructor(private readonly database: Database) {}

  async getAuthorizedRoot(
    releaseId: string,
    nowUnixSeconds: number,
  ): Promise<`0x${string}`> {
    const [current] = await this.database<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${releaseId}
    `;
    if (current === undefined) {
      throw new PersistenceError("release_not_found", "Release not found.");
    }
    const approval = await validateApprovedRelease(current, nowUnixSeconds, [
      "approved",
    ]);
    return approval.digest;
  }

  async recordPrepared(
    input: ManifestAnchorPreparedInput,
  ): Promise<ReleaseTransitionRow> {
    const attempt = manifestAnchorAttemptSchema.parse(input.attempt);
    const summary = safeManifestAnchorSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const approval = await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["approved"],
      );
      if (
        attempt.proofRoot !== approval.digest ||
        input.command.actor !== "deployment" ||
        input.command.event !== "manifest_anchor_started" ||
        input.command.evidenceRef !== approval.digest
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The prepared HERŌ root does not match the approved manifest.",
        );
      }
      const result = manifestAnchorTransition(current, input);
      return saveManifestAnchorTransition({
        attempt,
        current,
        input,
        result,
        summary,
        transaction,
      });
    });
  }

  async markBroadcasting(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<ManifestAnchorAttempt> {
    return this.updateAttempt(
      releaseId,
      workerId,
      leaseToken,
      nowUnixSeconds,
      (attempt) => {
        if (attempt.kind !== "prepared" || attempt.status !== "prepared") {
          throw new PersistenceError(
            "transition_rejected",
            "The manifest anchor is not ready to broadcast.",
          );
        }
        return { ...attempt, status: "broadcasting" };
      },
    );
  }

  async markSubmitted(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<ManifestAnchorAttempt> {
    return this.updateAttempt(
      releaseId,
      workerId,
      leaseToken,
      nowUnixSeconds,
      (attempt) => {
        if (attempt.kind !== "prepared" || attempt.status !== "broadcasting") {
          throw new PersistenceError(
            "transition_rejected",
            "The manifest anchor is not awaiting a transaction hash.",
          );
        }
        return { ...attempt, status: "submitted", transactionHash };
      },
      false,
    );
  }

  async recordOutcome(
    input: ManifestAnchorOutcomeInput,
  ): Promise<ReleaseTransitionRow> {
    const summary = safeManifestAnchorSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const approval = await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["anchoring_manifest", "reconciliation_required"],
        false,
      );
      const attempt = manifestAnchorAttemptSchema.safeParse(
        current.manifestAnchorAttempt,
      );
      if (
        !attempt.success ||
        attempt.data.proofRoot !== approval.digest ||
        input.command.actor !== "deployment" ||
        input.command.evidenceRef !== approval.digest
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The stored HERŌ attempt does not match the approved manifest.",
        );
      }
      const result = manifestAnchorTransition(current, input);
      return saveManifestAnchorTransition({
        attempt: nextManifestAnchorAttempt(attempt.data, input.command.event),
        current,
        input,
        result,
        summary,
        transaction,
      });
    });
  }

  private async updateAttempt(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
    update: (attempt: ManifestAnchorAttempt) => ManifestAnchorAttempt,
    requireUnexpired = true,
  ): Promise<ManifestAnchorAttempt> {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      await validateApprovedRelease(
        current,
        nowUnixSeconds,
        ["anchoring_manifest"],
        requireUnexpired,
      );
      const parsed = manifestAnchorAttemptSchema.safeParse(
        current.manifestAnchorAttempt,
      );
      if (!parsed.success) {
        throw new PersistenceError(
          "transition_rejected",
          "The stored HERŌ attempt is malformed.",
        );
      }
      const attempt = manifestAnchorAttemptSchema.parse(update(parsed.data));
      const changed = await transaction`
        UPDATE releases
        SET manifest_anchor_attempt = ${transaction.json(attempt)}
        WHERE id = ${releaseId}
          AND version = ${current.version}
          AND lease_owner = ${workerId}
          AND lease_token = ${leaseToken}
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
}
