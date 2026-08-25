import { randomUUID } from "node:crypto";

import {
  createSwarmShipAgents,
  type AgentToolExecutors,
} from "@swarmship/agents";
import { parseWorkerEnvironment } from "@swarmship/domain/environment";
import {
  closeDatabase,
  createDatabase,
  LeaseRepository,
  runMigrations,
  SpecificationRepository,
} from "@swarmship/persistence";

import { getWorkerHealth } from "./health.js";
import { processOneSpecification } from "./specification-processor.js";

const unavailableTool = async (): Promise<never> => {
  throw new Error("This worker slice cannot run that agent tool yet.");
};
const executors: AgentToolExecutors = {
  readIndependentEvidence: unavailableTool,
  renderTaskRegistry: unavailableTool,
  requestGuardedDeployment: unavailableTool,
  runReleaseVerification: unavailableTool,
};

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

const environment = parseWorkerEnvironment(process.env);
const health = getWorkerHealth(environment);
const database = createDatabase(environment.DATABASE_URL, {
  applicationName: "swarmship-worker",
});
await runMigrations(database);
const agents = createSwarmShipAgents({
  executors,
  model: environment.SWARMSHIP_AGENT_MODEL,
});
const leases = new LeaseRepository(database);
const specifications = new SpecificationRepository(database);
const workerId = `specification-${randomUUID()}`;
const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

console.log(`SwarmShip worker ready with ${health.pollIntervalMs}ms polling`);

try {
  while (!shutdown.signal.aborted) {
    try {
      const result = await processOneSpecification({
        agents,
        leaseSeconds: environment.WORKER_LEASE_SECONDS,
        leases,
        retrySeconds: environment.WORKER_RETRY_SECONDS,
        specifications,
        workerId,
      });
      if (result.status !== "idle") {
        console.log("SwarmShip worker step", result);
      }
    } catch (error) {
      console.error("SwarmShip worker loop error", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await wait(health.pollIntervalMs, shutdown.signal);
  }
} finally {
  await closeDatabase(database);
}
