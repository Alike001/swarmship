import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  createDatabase,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";

import { createMcpReleaseService, createSwarmShipMcpServer } from "./mcp.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const database = createDatabase(databaseUrl, {
  applicationName: "swarmship-mcp-stdio",
});
await runMigrations(database);
const server = createSwarmShipMcpServer(
  createMcpReleaseService(new ReleaseRepository(database)),
);
await server.connect(new StdioServerTransport());
