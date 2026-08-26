import { randomUUID } from "node:crypto";

import {
  applyReleaseTransition,
  type ReleaseTransitionCommand,
} from "@swarmship/domain/release";

import type { Database, TransactionDatabase } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  CreateReleaseInput,
  CreateReleaseResult,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export class ReleaseRepository {
  constructor(private readonly database: Database) {}

  async create(input: CreateReleaseInput): Promise<CreateReleaseResult> {
    const id = randomUUID();
    const publicId = `release_${id.replaceAll("-", "")}`;

    return this.database.begin(async (transaction) => {
      if (input.idempotency !== undefined) {
        const response = { releaseId: id, publicId };
        const inserted = await transaction`
          INSERT INTO idempotency_keys (
            caller_scope, key, operation, request_hash, release_id, saved_response
          ) VALUES (
            ${input.idempotency.callerScope}, ${input.idempotency.key},
            ${input.idempotency.operation}, ${input.idempotency.requestHash},
            ${id}, ${transaction.json(response)}
          )
          ON CONFLICT (caller_scope, key, operation) DO NOTHING
          RETURNING release_id
        `;

        if (inserted.length === 0) {
          return this.resolveExistingIdempotentRelease(transaction, input);
        }
      }

      const [release] = await transaction<ReleaseRow[]>`
        INSERT INTO releases (id, public_id, original_request)
        VALUES (${id}, ${publicId}, ${input.originalRequest})
        RETURNING *
      `;
      if (release === undefined)
        throw new Error("Release insert returned no row.");
      return { created: true, release };
    });
  }

  async get(releaseId: string): Promise<ReleaseRow | null> {
    const [release] = await this.database<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${releaseId}
    `;
    return release ?? null;
  }

  async getByPublicId(publicId: string): Promise<ReleaseRow | null> {
    const [release] = await this.database<ReleaseRow[]>`
      SELECT * FROM releases WHERE public_id = ${publicId}
    `;
    return release ?? null;
  }

  async listTransitions(releaseId: string): Promise<ReleaseTransitionRow[]> {
    return this.database<ReleaseTransitionRow[]>`
      SELECT * FROM release_transitions
      WHERE release_id = ${releaseId}
      ORDER BY version_after ASC
    `;
  }

  async transition(
    releaseId: string,
    command: ReleaseTransitionCommand,
  ): Promise<ReleaseTransitionRow> {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${releaseId}
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
        command,
      );
      if (!result.success) {
        throw new PersistenceError("transition_rejected", result.error.message);
      }

      const invalidateBuild = result.record.effects.includes(
        "invalidate_build_evidence",
      );
      const invalidateApproval = result.record.effects.includes(
        "invalidate_manifest_approval",
      );
      const updated = await transaction`
        UPDATE releases
        SET state = ${result.snapshot.state},
            version = ${result.snapshot.version},
            reconciliation_kind = ${result.snapshot.reconciliation},
            build_evidence = CASE WHEN ${invalidateBuild} THEN NULL ELSE build_evidence END,
            verification_evidence = CASE WHEN ${invalidateBuild} THEN NULL ELSE verification_evidence END,
            manifest_approval = CASE WHEN ${invalidateApproval} THEN NULL ELSE manifest_approval END,
            updated_at = clock_timestamp()
        WHERE id = ${releaseId} AND version = ${result.record.versionBefore}
        RETURNING id
      `;
      if (updated.length === 0) {
        throw new PersistenceError(
          "transition_conflict",
          "This release changed before the action could be saved.",
        );
      }

      const [record] = await transaction<ReleaseTransitionRow[]>`
        INSERT INTO release_transitions (
          release_id, version_before, version_after, actor, event,
          from_state, to_state, evidence_ref, effects
        ) VALUES (
          ${releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
          ${result.record.actor}, ${result.record.event}, ${result.record.from},
          ${result.record.to}, ${result.record.evidenceRef},
          ${transaction.json(result.record.effects)}
        )
        RETURNING *
      `;
      if (record === undefined)
        throw new Error("Transition insert returned no row.");
      return record;
    });
  }

  private async resolveExistingIdempotentRelease(
    transaction: TransactionDatabase,
    input: CreateReleaseInput,
  ): Promise<CreateReleaseResult> {
    const idempotency = input.idempotency;
    if (idempotency === undefined)
      throw new Error("Idempotency input is missing.");

    const [existing] = await transaction<
      { requestHash: string; releaseId: string }[]
    >`
      SELECT request_hash, release_id FROM idempotency_keys
      WHERE caller_scope = ${idempotency.callerScope}
        AND key = ${idempotency.key}
        AND operation = ${idempotency.operation}
    `;
    if (
      existing === undefined ||
      existing.requestHash !== idempotency.requestHash
    ) {
      throw new PersistenceError(
        "idempotency_conflict",
        "This idempotency key was already used for a different request.",
      );
    }

    const [release] = await transaction<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${existing.releaseId}
    `;
    if (release === undefined)
      throw new Error("Idempotent release is missing.");
    return { created: false, release };
  }
}
