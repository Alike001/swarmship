import { randomUUID } from "node:crypto";

import { RELEASE_STATES, type ReleaseState } from "@swarmship/domain";
import {
  RECONCILIATION_KINDS,
  type ReconciliationKind,
} from "@swarmship/domain/release";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  DeferredReleaseError,
  ReleaseLease,
  ReleaseRow,
} from "./types.js";

const claimableStates = RELEASE_STATES.filter(
  (state) => state !== "verified" && state !== "failed",
);

function validateDuration(durationSeconds: number): void {
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 3600
  ) {
    throw new RangeError("Lease duration must be between 1 and 3600 seconds.");
  }
}

function validateStates(states: readonly ReleaseState[]): void {
  if (
    states.length === 0 ||
    states.some((state) => !RELEASE_STATES.includes(state))
  ) {
    throw new RangeError("At least one valid release state is required.");
  }
}

function validateDeferredError(error: DeferredReleaseError): void {
  if (
    error.code.length < 1 ||
    error.code.length > 80 ||
    !/^[a-z0-9_]+$/.test(error.code) ||
    error.message.length < 1 ||
    error.message.length > 300
  ) {
    throw new RangeError("Deferred errors must use bounded safe fields.");
  }
}

export class LeaseRepository {
  constructor(private readonly database: Database) {}

  async claimById(
    releaseId: string,
    workerId: string,
    durationSeconds: number,
    states: readonly ReleaseState[] = claimableStates,
    reconciliationKinds?: readonly ReconciliationKind[],
  ): Promise<ReleaseLease | null> {
    validateDuration(durationSeconds);
    validateStates(states);
    if (
      reconciliationKinds !== undefined &&
      (reconciliationKinds.length === 0 ||
        reconciliationKinds.some(
          (kind) => !RECONCILIATION_KINDS.includes(kind),
        ))
    ) {
      throw new RangeError(
        "At least one valid reconciliation kind is required.",
      );
    }
    const token = randomUUID();
    const [release] = await this.database<ReleaseRow[]>`
      UPDATE releases
      SET lease_owner = ${workerId},
          lease_token = ${token},
          lease_expires_at = clock_timestamp() + make_interval(secs => ${durationSeconds}),
          updated_at = clock_timestamp()
      WHERE id = ${releaseId}
        AND state = ANY(${this.database.array([...states])})
        AND (
          state <> 'reconciliation_required'
          OR ${reconciliationKinds === undefined}
          OR reconciliation_kind = ANY(${this.database.array([
            ...(reconciliationKinds ?? RECONCILIATION_KINDS),
          ])})
        )
        AND next_attempt_at <= clock_timestamp()
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      RETURNING *
    `;
    return release === undefined ? null : { release, token };
  }

  async claimNext(
    workerId: string,
    durationSeconds: number,
    states: readonly ReleaseState[] = claimableStates,
    reconciliationKinds?: readonly ReconciliationKind[],
  ): Promise<ReleaseLease | null> {
    validateDuration(durationSeconds);
    validateStates(states);
    if (
      reconciliationKinds !== undefined &&
      (reconciliationKinds.length === 0 ||
        reconciliationKinds.some(
          (kind) => !RECONCILIATION_KINDS.includes(kind),
        ))
    ) {
      throw new RangeError(
        "At least one valid reconciliation kind is required.",
      );
    }
    const token = randomUUID();
    const [release] = await this.database<ReleaseRow[]>`
      WITH candidate AS (
        SELECT id FROM releases
        WHERE state = ANY(${this.database.array([...states])})
          AND (
            state <> 'reconciliation_required'
            OR ${reconciliationKinds === undefined}
            OR reconciliation_kind = ANY(${this.database.array([
              ...(reconciliationKinds ?? RECONCILIATION_KINDS),
            ])})
          )
          AND next_attempt_at <= clock_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE releases AS release
      SET lease_owner = ${workerId},
          lease_token = ${token},
          lease_expires_at = clock_timestamp() + make_interval(secs => ${durationSeconds}),
          updated_at = clock_timestamp()
      FROM candidate
      WHERE release.id = candidate.id
      RETURNING release.*
    `;
    return release === undefined ? null : { release, token };
  }

  async defer(
    releaseId: string,
    workerId: string,
    token: string,
    error: DeferredReleaseError,
    delaySeconds: number,
  ): Promise<void> {
    validateDuration(delaySeconds);
    validateDeferredError(error);
    const deferred = await this.database`
      UPDATE releases
      SET safe_error = ${this.database.json(error)},
          retry_count = retry_count + 1,
          next_attempt_at = clock_timestamp() + make_interval(secs => ${delaySeconds}),
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = ${releaseId}
        AND lease_owner = ${workerId}
        AND lease_token = ${token}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    if (deferred.length === 0) {
      throw new PersistenceError(
        "lease_lost",
        "This worker no longer owns the release lease.",
      );
    }
  }

  async renew(
    releaseId: string,
    workerId: string,
    token: string,
    durationSeconds: number,
  ): Promise<ReleaseLease> {
    validateDuration(durationSeconds);
    const [release] = await this.database<ReleaseRow[]>`
      UPDATE releases
      SET lease_expires_at = clock_timestamp() + make_interval(secs => ${durationSeconds}),
          updated_at = clock_timestamp()
      WHERE id = ${releaseId}
        AND lease_owner = ${workerId}
        AND lease_token = ${token}
        AND lease_expires_at > clock_timestamp()
      RETURNING *
    `;
    if (release === undefined) {
      throw new PersistenceError(
        "lease_lost",
        "This worker no longer owns the release lease.",
      );
    }
    return { release, token };
  }

  async release(
    releaseId: string,
    workerId: string,
    token: string,
  ): Promise<void> {
    const released = await this.database`
      UPDATE releases
      SET lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = ${releaseId}
        AND lease_owner = ${workerId}
        AND lease_token = ${token}
      RETURNING id
    `;
    if (released.length === 0) {
      throw new PersistenceError(
        "lease_lost",
        "This worker no longer owns the release lease.",
      );
    }
  }
}
