import { validateBuildEvidence } from "@swarmship/builder";
import { applyReleaseTransition } from "@swarmship/domain/release";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  BuildResultInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

function validateBuildResult(input: BuildResultInput, current: ReleaseRow) {
  const summary = input.summary.trim();
  if (
    summary.length < 1 ||
    summary.length > 600 ||
    input.command.actor !== "build" ||
    input.command.event !== "build_started" ||
    input.command.evidenceRef !== input.evidence.evidenceRef ||
    current.specification === null
  ) {
    throw new PersistenceError(
      "transition_rejected",
      "The build result is incomplete or inconsistent.",
    );
  }
  try {
    return validateBuildEvidence(
      input.evidence,
      current.specification,
      input.nowUnixSeconds,
    );
  } catch {
    throw new PersistenceError(
      "transition_rejected",
      "The build evidence does not match the accepted specification.",
    );
  }
}

export class BuildRepository {
  constructor(private readonly database: Database) {}

  async record(input: BuildResultInput): Promise<ReleaseTransitionRow> {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const evidence = validateBuildResult(input, current);
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

      const updated = await transaction`
        UPDATE releases
        SET state = ${result.snapshot.state},
            version = ${result.snapshot.version},
            reconciliation_kind = ${result.snapshot.reconciliation},
            build_evidence = ${transaction.json(evidence)},
            safe_error = NULL,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${input.releaseId}
          AND version = ${result.record.versionBefore}
          AND lease_owner = ${input.workerId}
          AND lease_token = ${input.leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      if (updated.length === 0) {
        throw new PersistenceError(
          "lease_lost",
          "This worker no longer owns the release lease.",
        );
      }

      const [record] = await transaction<ReleaseTransitionRow[]>`
        INSERT INTO release_transitions (
          release_id, version_before, version_after, actor, event,
          from_state, to_state, evidence_ref, effects, tool_name,
          safe_summary, deterministic_result
        ) VALUES (
          ${input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
          ${result.record.actor}, ${result.record.event}, ${result.record.from},
          ${result.record.to}, ${result.record.evidenceRef},
          ${transaction.json(result.record.effects)}, ${"render_task_registry"},
          ${input.summary.trim()}, ${transaction.json({
            sourceHash: evidence.sourceHash,
            templateVersion: evidence.templateVersion,
            testInputHash: evidence.testInputHash,
          })}
        )
        RETURNING *
      `;
      if (record === undefined) {
        throw new Error("Build transition insert returned no row.");
      }
      return record;
    });
  }
}
