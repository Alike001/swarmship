import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PersistenceError } from "./errors.js";
import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";

const HASH_A = `0x${"11".repeat(32)}` as const;
const HASH_B = `0x${"22".repeat(32)}` as const;
const EVIDENCE = `0x${"33".repeat(32)}` as const;

describe("ReleaseRepository", () => {
  const repository = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  it("returns the original release for a repeated idempotent request", async () => {
    const input = {
      originalRequest: "Create a bounded registry.",
      idempotency: {
        callerScope: "browser:alice",
        key: "request-1",
        operation: "create_release",
        requestHash: HASH_A,
      },
    };

    const first = await repository.create(input);
    const repeated = await repository.create(input);

    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.release.id).toBe(first.release.id);
    const countRows = await testDatabase<{ count: string }[]>`
      SELECT count(*)::text AS count FROM releases
    `;
    expect(countRows[0]?.count).toBe("1");
  });

  it("reads a release through its public proof identifier", async () => {
    const { release } = await repository.create({
      originalRequest: "Create a bounded registry.",
    });

    await expect(
      repository.getByPublicId(release.publicId),
    ).resolves.toMatchObject({
      id: release.id,
      publicId: release.publicId,
    });
    await expect(
      repository.getByPublicId(`release_${"f".repeat(32)}`),
    ).resolves.toBeNull();
  });

  it("creates one release when identical requests arrive concurrently", async () => {
    const input = {
      originalRequest: "Create a bounded registry.",
      idempotency: {
        callerScope: "mcp:client-1",
        key: "concurrent-request",
        operation: "create_release",
        requestHash: HASH_A,
      },
    };

    const results = await Promise.all([
      repository.create(input),
      repository.create(input),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]?.release.id).toBe(results[1]?.release.id);
  });

  it("rejects reuse of an idempotency key for different input", async () => {
    const idempotency = {
      callerScope: "browser:alice",
      key: "request-1",
      operation: "create_release",
      requestHash: HASH_A,
    };
    await repository.create({ originalRequest: "First", idempotency });

    await expect(
      repository.create({
        originalRequest: "Changed",
        idempotency: { ...idempotency, requestHash: HASH_B },
      }),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      name: PersistenceError.name,
    });
  });

  it("atomically stores the projection and append-only transition", async () => {
    const { release } = await repository.create({
      originalRequest: "Registry",
    });
    const record = await repository.transition(release.id, {
      actor: "specification",
      event: "specification_accepted",
      expectedVersion: 0,
      evidenceRef: EVIDENCE,
    });

    expect(record).toMatchObject({
      actor: "specification",
      fromState: "created",
      toState: "specified",
      versionBefore: 0,
      versionAfter: 1,
      evidenceRef: EVIDENCE,
    });
    expect(await repository.get(release.id)).toMatchObject({
      state: "specified",
      version: 1,
    });
    expect(await repository.listTransitions(release.id)).toHaveLength(1);
  });

  it("allows only one of two concurrent transitions to commit", async () => {
    const { release } = await repository.create({
      originalRequest: "Registry",
    });
    const command = {
      actor: "specification" as const,
      event: "specification_accepted" as const,
      expectedVersion: 0,
      evidenceRef: EVIDENCE,
    };

    const results = await Promise.allSettled([
      repository.transition(release.id, command),
      repository.transition(release.id, command),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await repository.listTransitions(release.id)).toHaveLength(1);
    expect(await repository.get(release.id)).toMatchObject({ version: 1 });
  });

  it("rolls back the projection when the transition append fails", async () => {
    const { release } = await repository.create({
      originalRequest: "Registry",
    });
    await testDatabase`
      INSERT INTO release_transitions (
        release_id, version_before, version_after, actor, event,
        from_state, to_state, evidence_ref, effects
      ) VALUES (
        ${release.id}, 0, 1, 'system', 'reserved_test_record',
        'created', 'failed', ${EVIDENCE}, '[]'::jsonb
      )
    `;

    await expect(
      repository.transition(release.id, {
        actor: "specification",
        event: "specification_accepted",
        expectedVersion: 0,
        evidenceRef: EVIDENCE,
      }),
    ).rejects.toBeDefined();
    expect(await repository.get(release.id)).toMatchObject({
      state: "created",
      version: 0,
    });
  });
});
