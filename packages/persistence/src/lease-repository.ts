import { randomUUID } from "node:crypto";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import type { ReleaseLease, ReleaseRow } from "./types.js";

function validateDuration(durationSeconds: number): void {
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 3600
  ) {
    throw new RangeError("Lease duration must be between 1 and 3600 seconds.");
  }
}

export class LeaseRepository {
  constructor(private readonly database: Database) {}

  async claimNext(
    workerId: string,
    durationSeconds: number,
  ): Promise<ReleaseLease | null> {
    validateDuration(durationSeconds);
    const token = randomUUID();
    const [release] = await this.database<ReleaseRow[]>`
      WITH candidate AS (
        SELECT id FROM releases
        WHERE state NOT IN ('verified', 'failed')
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
