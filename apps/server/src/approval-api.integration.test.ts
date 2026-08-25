import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { ReleaseManifestV1 } from "@swarmship/domain/release";
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
const schema = "swarmship_approval_api_test";
let adminDatabase: Database;
let testDatabase: Database;
let app: App;

beforeAll(async () => {
  adminDatabase = createDatabase(databaseUrl, {
    applicationName: "swarmship-approval-api-test-admin",
  });
  await adminDatabase`DROP SCHEMA IF EXISTS ${adminDatabase(schema)} CASCADE`;
  await adminDatabase`CREATE SCHEMA ${adminDatabase(schema)}`;
  testDatabase = createDatabase(databaseUrl, {
    applicationName: "swarmship-approval-api-test",
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

async function makeReleaseApprovable() {
  const owner = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1_000);
  const releases = new ReleaseRepository(testDatabase);
  const created = await releases.create({ originalRequest: "Registry" });
  const hash = (character: string) => `0x${character.repeat(64)}`;
  await testDatabase`
    UPDATE releases
    SET state = 'awaiting_approval',
        version = 3,
        specification = ${testDatabase.json({
          contractFamily: "agent-task-registry-v1",
          owner: owner.address,
          permittedSender: "0x0000000000000000000000000000000000000002",
          permittedReceiver: "0x0000000000000000000000000000000000000003",
          maxHandoffs: 5,
          expiry: now + 86_400,
        })},
        build_evidence = ${testDatabase.json({
          evidenceRef: hash("1"),
          sourceFiles: [{ path: "Cargo.toml", content: "private source" }],
          sourceHash: hash("2"),
          templateVersion: "agent-task-registry-v1@1",
          testInputHash: hash("3"),
        })},
        verification_evidence = ${testDatabase.json({
          artifactBase64: "cHJpdmF0ZS13YXNt",
          artifactHash: hash("4"),
          buildEvidenceRef: hash("1"),
          checks: [{ name: "rust_tests", status: "passed" }],
          evidenceRef: hash("5"),
          status: "passed",
          testEvidenceHash: hash("6"),
          toolchain: { rustc: "private tool details" },
          toolchainHash: hash("7"),
          version: "agent-task-registry-verification-v1",
        })},
        updated_at = clock_timestamp()
    WHERE id = ${created.release.id}
  `;
  return { owner, releaseId: created.release.id };
}

describe("approval API", () => {
  it("returns exact signable data and stores the owner approval", async () => {
    const { owner, releaseId } = await makeReleaseApprovable();
    const request = await app.request(`/api/releases/${releaseId}/approval`);
    expect(request.status).toBe(200);
    const signing = (await request.json()) as {
      approval: {
        digest: string;
        manifest: ReleaseManifestV1;
        typedData: Parameters<typeof hashTypedData>[0];
      };
    };
    expect(signing.approval.typedData.primaryType).toBe("ReleaseManifestV1");
    expect(hashTypedData(signing.approval.typedData)).toBe(
      signing.approval.digest,
    );
    expect(JSON.stringify(signing)).not.toContain("private source");
    expect(JSON.stringify(signing)).not.toContain("private-wasm");
    const signature = await owner.signTypedData(signing.approval.typedData);

    const approved = await app.request(`/api/releases/${releaseId}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 3, signature }),
    });
    expect(approved.status).toBe(201);
    await expect(approved.json()).resolves.toMatchObject({
      created: true,
      approval: { digest: signing.approval.digest, signer: owner.address },
      release: { state: "approved", version: 4 },
    });
  });

  it("rejects client-supplied manifest fields before persistence", async () => {
    const { releaseId } = await makeReleaseApprovable();
    const response = await app.request(`/api/releases/${releaseId}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 3,
        manifest: { chainId: 1 },
        signature: `0x${"1".repeat(130)}`,
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_approval" },
    });
  });
});
