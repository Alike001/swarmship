import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ApprovalRepository,
  closeDatabase,
  createDatabase,
  ReleaseRepository,
  runMigrations,
  type Database,
} from "@swarmship/persistence";

import { createApp, type App } from "./app.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:55432/postgres";
const schema = "swarmship_server_test";
let adminDatabase: Database;
let testDatabase: Database;
let app: App;

async function postRelease(key: string, request: string): Promise<Response> {
  return app.request("/api/releases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ request }),
  });
}

beforeAll(async () => {
  adminDatabase = createDatabase(databaseUrl, {
    applicationName: "swarmship-server-test-admin",
  });
  await adminDatabase`DROP SCHEMA IF EXISTS ${adminDatabase(schema)} CASCADE`;
  await adminDatabase`CREATE SCHEMA ${adminDatabase(schema)}`;
  testDatabase = createDatabase(databaseUrl, {
    applicationName: "swarmship-server-test",
    searchPath: schema,
  });
  await runMigrations(testDatabase);
  app = createApp({
    approvals: new ApprovalRepository(testDatabase),
    releases: new ReleaseRepository(testDatabase),
  });
});

beforeEach(async () => {
  await testDatabase`
    TRUNCATE idempotency_keys, chain_events, release_transitions, releases
    RESTART IDENTITY CASCADE
  `;
});

afterAll(async () => {
  await closeDatabase(testDatabase);
  await adminDatabase`DROP SCHEMA IF EXISTS ${adminDatabase(schema)} CASCADE`;
  await closeDatabase(adminDatabase);
});

describe("persisted release API", () => {
  it("creates and reads one real persisted release", async () => {
    const created = await postRelease(
      "release-create-1",
      "Create a registry where agent A may hand work to agent B five times.",
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      release: { releaseId: string; state: string };
    };
    expect(body.release).toMatchObject({ state: "created" });
    expect(created.headers.get("location")).toBe(
      `/api/releases/${body.release.releaseId}`,
    );

    const read = await app.request(`/api/releases/${body.release.releaseId}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      release: {
        releaseId: body.release.releaseId,
        state: "created",
        version: 0,
      },
      transitions: [],
    });
  });

  it("returns one release for concurrent identical requests", async () => {
    const request =
      "Create a bounded registry for two approved agent addresses.";
    const responses = await Promise.all([
      postRelease("concurrent-create", request),
      postRelease("concurrent-create", request),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const bodies = await Promise.all(
      responses.map(
        async (response) =>
          response.json() as Promise<{ release: { releaseId: string } }>,
      ),
    );
    expect(bodies[0]?.release.releaseId).toBe(bodies[1]?.release.releaseId);
  });

  it("exposes build hashes without returning the stored source bundle", async () => {
    const created = await postRelease(
      "release-build-evidence",
      "Create a bounded registry for two approved agents.",
    );
    const body = (await created.json()) as {
      release: { releaseId: string };
    };
    const evidence = {
      evidenceRef: `0x${"1".repeat(64)}`,
      sourceFiles: [{ path: "Cargo.toml", content: "private source" }],
      sourceHash: `0x${"2".repeat(64)}`,
      templateVersion: "agent-task-registry-v1@1",
      testInputHash: `0x${"3".repeat(64)}`,
    };
    await testDatabase`
      UPDATE releases
      SET build_evidence = ${testDatabase.json(evidence)}
      WHERE id = ${body.release.releaseId}
    `;

    const read = await app.request(`/api/releases/${body.release.releaseId}`);
    const result = (await read.json()) as { release: unknown };

    expect(result.release).toMatchObject({
      build: {
        evidenceRef: evidence.evidenceRef,
        sourceHash: evidence.sourceHash,
        templateVersion: evidence.templateVersion,
        testInputHash: evidence.testInputHash,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private source");
    expect(JSON.stringify(result)).not.toContain("sourceFiles");
  });

  it("exposes verification proof without returning artifact bytes", async () => {
    const created = await postRelease(
      "release-verification-evidence",
      "Create and verify a bounded registry for approved agents.",
    );
    const body = (await created.json()) as {
      release: { releaseId: string };
    };
    const evidence = {
      artifactBase64: "cHJpdmF0ZS13YXNt",
      artifactHash: `0x${"4".repeat(64)}`,
      checks: [{ name: "rust_tests", status: "passed" }],
      evidenceRef: `0x${"5".repeat(64)}`,
      status: "passed",
      testEvidenceHash: `0x${"6".repeat(64)}`,
      toolchain: { rustc: "private tool details" },
      toolchainHash: `0x${"7".repeat(64)}`,
    };
    await testDatabase`
      UPDATE releases
      SET verification_evidence = ${testDatabase.json(evidence)}
      WHERE id = ${body.release.releaseId}
    `;

    const read = await app.request(`/api/releases/${body.release.releaseId}`);
    const result = (await read.json()) as { release: unknown };

    expect(result.release).toMatchObject({
      verification: {
        artifactHash: evidence.artifactHash,
        checks: evidence.checks,
        evidenceRef: evidence.evidenceRef,
        status: "passed",
        testEvidenceHash: evidence.testEvidenceHash,
        toolchainHash: evidence.toolchainHash,
      },
    });
    expect(JSON.stringify(result)).not.toContain("artifactBase64");
    expect(JSON.stringify(result)).not.toContain("private-wasm");
    expect(JSON.stringify(result)).not.toContain("private tool details");
  });

  it("rejects idempotency-key reuse for changed input", async () => {
    await postRelease(
      "conflicting-create",
      "Create the first bounded task registry for approved agents.",
    );
    const conflict = await postRelease(
      "conflicting-create",
      "Create a different bounded task registry for other agents.",
    );

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "idempotency_conflict" },
    });
  });

  it("returns a safe not-found response for an unknown UUID", async () => {
    const response = await app.request(
      "/api/releases/00000000-0000-4000-8000-000000000000",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "release_not_found", message: "Release not found." },
    });
  });
});
