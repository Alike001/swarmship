import { serve } from "@hono/node-server";

import { parseServerEnvironment } from "@swarmship/domain/environment";
import {
  ApprovalRepository,
  createDatabase,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";

import { createApp } from "./app.js";

const environment = parseServerEnvironment(process.env);
const database = createDatabase(environment.DATABASE_URL, {
  applicationName: "swarmship-server",
});
await runMigrations(database);
const app = createApp({
  approvals: new ApprovalRepository(database),
  releases: new ReleaseRepository(database),
  webOrigin: environment.WEB_ORIGIN,
});

serve(
  {
    fetch: app.fetch,
    hostname: environment.HOST,
    port: environment.PORT,
  },
  (info) => {
    console.log(`SwarmShip server listening on port ${info.port}`);
  },
);
