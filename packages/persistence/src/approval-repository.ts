import {
  applyReleaseTransition,
  hashReleaseManifest,
  summarizeReleaseManifest,
  verifyManifestApproval,
} from "@swarmship/domain/release";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import { pendingManifest, storedApproval } from "./release-guard.js";
import type {
  ApproveReleaseInput,
  ApproveReleaseResult,
  ReleaseApprovalRequest,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export class ApprovalRepository {
  constructor(private readonly database: Database) {}

  async getRequest(
    releaseId: string,
    nowUnixSeconds: number,
  ): Promise<ReleaseApprovalRequest> {
    const [current] = await this.database<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${releaseId}
    `;
    if (current === undefined) {
      throw new PersistenceError("release_not_found", "Release not found.");
    }
    const saved = storedApproval(current);
    const manifest = saved?.manifest ?? pendingManifest(current);
    if (saved === null && manifest.approvalExpiry <= nowUnixSeconds) {
      throw new PersistenceError(
        "transition_rejected",
        "This approval window expired. Rebuild the release before signing.",
      );
    }
    return {
      digest: saved?.digest ?? hashReleaseManifest(manifest),
      manifest,
      summary: summarizeReleaseManifest(manifest),
    };
  }

  async approve(input: ApproveReleaseInput): Promise<ApproveReleaseResult> {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId} FOR UPDATE
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const saved = storedApproval(current);
      if (saved !== null) {
        if (
          typeof input.signature === "string" &&
          saved.signature.toLowerCase() === input.signature.toLowerCase()
        ) {
          return {
            approval: saved,
            created: false,
            release: current,
            transition: null,
          };
        }
        throw new PersistenceError(
          "approval_conflict",
          "This release already has a different owner approval.",
        );
      }
      if (current.version !== input.expectedVersion) {
        throw new PersistenceError(
          "transition_conflict",
          "This release changed before approval. Reload its latest state.",
        );
      }
      const manifest = pendingManifest(current);
      const verified = await verifyManifestApproval(
        manifest,
        input.signature,
        input.nowUnixSeconds,
      );
      if (!verified.success) {
        throw new PersistenceError(
          "transition_rejected",
          verified.error.message,
        );
      }
      const result = applyReleaseTransition(
        {
          state: current.state,
          version: current.version,
          reconciliation: current.reconciliationKind,
        },
        {
          actor: "user",
          event: "approval_granted",
          evidenceRef: verified.data.digest,
          expectedVersion: input.expectedVersion,
        },
      );
      if (!result.success) {
        throw new PersistenceError("transition_rejected", result.error.message);
      }

      const [release] = await transaction<ReleaseRow[]>`
        UPDATE releases
        SET state = ${result.snapshot.state},
            version = ${result.snapshot.version},
            reconciliation_kind = ${result.snapshot.reconciliation},
            manifest_approval = ${transaction.json(verified.data)},
            safe_error = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${input.releaseId}
          AND version = ${result.record.versionBefore}
        RETURNING *
      `;
      if (release === undefined) {
        throw new PersistenceError(
          "transition_conflict",
          "This release changed before approval could be saved.",
        );
      }
      const [transition] = await transaction<ReleaseTransitionRow[]>`
        INSERT INTO release_transitions (
          release_id, version_before, version_after, actor, event,
          from_state, to_state, evidence_ref, effects, tool_name,
          safe_summary, deterministic_result
        ) VALUES (
          ${input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
          ${result.record.actor}, ${result.record.event}, ${result.record.from},
          ${result.record.to}, ${result.record.evidenceRef},
          ${transaction.json(result.record.effects)}, ${"approve_release_manifest"},
          ${"The contract owner approved the exact verified release."},
          ${transaction.json({
            approvalExpiry: verified.data.manifest.approvalExpiry,
            digest: verified.data.digest,
            signer: verified.data.signer,
          })}
        )
        RETURNING *
      `;
      if (transition === undefined) {
        throw new Error("Approval transition insert returned no row.");
      }
      return {
        approval: verified.data,
        created: true,
        release,
        transition,
      };
    });
  }
}
