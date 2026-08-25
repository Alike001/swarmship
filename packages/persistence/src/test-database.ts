import { closeDatabase, createDatabase, runMigrations } from "./database.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:55432/postgres";

export const testDatabase = createDatabase(databaseUrl);

export async function prepareTestDatabase(): Promise<void> {
  await runMigrations(testDatabase);
}

export async function resetTestDatabase(): Promise<void> {
  await testDatabase`
    TRUNCATE idempotency_keys, chain_events, release_transitions, releases
    RESTART IDENTITY CASCADE
  `;
}

export async function closeTestDatabase(): Promise<void> {
  await closeDatabase(testDatabase);
}
