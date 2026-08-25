import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres, { type Sql } from "postgres";

export type Database = Sql;
export type TransactionDatabase = postgres.TransactionSql;

export type DatabaseOptions = {
  applicationName?: string;
  searchPath?: string;
};

export function createDatabase(
  databaseUrl: string,
  options: DatabaseOptions = {},
): Database {
  const connection = {
    application_name: options.applicationName ?? "swarmship",
    statement_timeout: 30_000,
    ...(options.searchPath === undefined
      ? {}
      : { search_path: options.searchPath }),
  };
  return postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 10,
    max_lifetime: 60 * 30,
    transform: postgres.camel,
    connection,
  });
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.end({ timeout: 5 });
}

export async function runMigrations(database: Database): Promise<void> {
  await database`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `;

  const directory = fileURLToPath(new URL("../migrations", import.meta.url));
  const migrationFiles = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  await database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(786974487232)`;

    for (const migrationFile of migrationFiles) {
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM schema_migrations WHERE id = ${migrationFile}
      `;
      if (existing !== undefined) continue;

      await transaction.file(`${directory}/${migrationFile}`).simple();
      await transaction`
        INSERT INTO schema_migrations (id) VALUES (${migrationFile})
      `;
    }
  });
}
