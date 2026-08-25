import { applyReleaseTransition } from "@swarmship/domain/release";
import { validateVerificationEvidence } from "@swarmship/verifier";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  ReleaseRow,
  ReleaseTransitionRow,
  VerificationResultInput,
} from "./types.js";

function validateResult(input: VerificationResultInput, current: ReleaseRow) {
  const summary = input.summary.trim();
  const expectedEvent =
    input.evidence.status === "passed"
      ? "verification_passed"
      : "verification_failed";
  if (
    summary.length < 1 ||
    summary.length > 600 ||
    input.command.actor !== "verification" ||
    input.command.event !== expectedEvent ||
    input.command.evidenceRef !== input.evidence.evidenceRef ||
    current.specification === null ||
    current.buildEvidence === null
  ) {
    throw new PersistenceError(
      "transition_rejected",
      "The verification result is incomplete or inconsistent.",
    );
  }
  try {
    return validateVerificationEvidence(
      input.evidence,
      current.buildEvidence,
      current.specification,
      input.nowUnixSeconds,
    );
  } catch {
    throw new PersistenceError(
      "transition_rejected",
      "The verification evidence does not match the accepted build.",
    );
  }
}

export class VerificationRepository {
  constructor(private readonly database: Database) {}

  async record(input: VerificationResultInput): Promise<ReleaseTransitionRow> {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const evidence = validateResult(input, current);
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
            verification_evidence = ${transaction.json(evidence)},
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
          ${transaction.json(result.record.effects)}, ${"run_release_verification"},
          ${input.summary.trim()}, ${transaction.json({
            artifactHash: evidence.artifactHash,
            checks: evidence.checks.map(({ name, status }) => ({
              name,
              status,
            })),
            status: evidence.status,
            testEvidenceHash: evidence.testEvidenceHash,
            toolchainHash: evidence.toolchainHash,
          })}
        )
        RETURNING *
      `;
      if (record === undefined) {
        throw new Error("Verification transition insert returned no row.");
      }
      return record;
    });
  }
}
