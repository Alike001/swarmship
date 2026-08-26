import {
  ApprovalRepository,
  createDatabase,
  ReleaseRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";

import { createApp } from "../apps/server/src/app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const database = createDatabase(databaseUrl, {
  applicationName: "swarmship-vercel-api",
});
await runMigrations(database);

const app = createApp({
  approvals: new ApprovalRepository(database),
  releases: new ReleaseRepository(database),
  webOrigin: process.env.WEB_ORIGIN ?? "https://swarmship.vercel.app",
});

export default app;
