import {
  applyReleaseTransition,
  validateTaskRegistrySpec,
} from "@swarmship/domain/release";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  ReleaseRow,
  ReleaseTransitionRow,
  SpecificationResultInput,
} from "./types.js";

const specificationFields = new Set([
  "owner",
  "permittedSender",
  "permittedReceiver",
  "maxHandoffs",
  "expiry",
]);

function validateSpecificationResult(input: SpecificationResultInput): void {
  const summary = input.summary.trim();
  const uniqueMissingFields = new Set(input.missingFields);
  const validMissingFields = input.missingFields.every((field) =>
    specificationFields.has(field),
  );
  const accepted = input.command.event === "specification_accepted";
  const needsInput = input.command.event === "specification_needs_input";
  const validSpecification =
    input.specification === null
      ? false
      : validateTaskRegistrySpec(
          input.specification,
          Math.floor(Date.now() / 1_000),
        ).success;
  const consistent = accepted
    ? validSpecification && input.missingFields.length === 0
    : needsInput &&
      input.specification === null &&
      input.missingFields.length > 0 &&
      validMissingFields &&
      uniqueMissingFields.size === input.missingFields.length;

  if (summary.length < 1 || summary.length > 600 || !consistent) {
    throw new PersistenceError(
      "transition_rejected",
      "The specification result is incomplete or inconsistent.",
    );
  }
}

export class SpecificationRepository {
  constructor(private readonly database: Database) {}

  async record(input: SpecificationResultInput): Promise<ReleaseTransitionRow> {
    validateSpecificationResult(input);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }

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
            specification = ${input.specification === null ? null : transaction.json(input.specification)},
            specification_summary = ${input.summary},
            missing_fields = ${transaction.json(input.missingFields)},
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
          from_state, to_state, evidence_ref, effects, safe_summary,
          deterministic_result
        ) VALUES (
          ${input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
          ${result.record.actor}, ${result.record.event}, ${result.record.from},
          ${result.record.to}, ${result.record.evidenceRef},
          ${transaction.json(result.record.effects)}, ${input.summary},
          ${transaction.json({
            decision: input.specification === null ? "needs_input" : "accepted",
            missingFields: input.missingFields,
            specification: input.specification,
          })}
        )
        RETURNING *
      `;
      if (record === undefined) {
        throw new Error("Specification transition insert returned no row.");
      }
      return record;
    });
  }
}
