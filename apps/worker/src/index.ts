import { randomUUID } from "node:crypto";

import {
  createConfiguredAgentModel,
  createSwarmShipAgents,
  type AgentToolExecutors,
} from "@swarmship/agents";
import { parseWorkerEnvironment } from "@swarmship/domain/environment";
import {
  BuildRepository,
  closeDatabase,
  createDatabase,
  LeaseRepository,
  runMigrations,
  SpecificationRepository,
  VerificationRepository,
} from "@swarmship/persistence";

import { processOneBuild } from "./build-processor.js";
import { getWorkerHealth } from "./health.js";
import { processOneSpecification } from "./specification-processor.js";
import { processOneVerification } from "./verification-processor.js";

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
const configuredModel = createConfiguredAgentModel(process.env);
const database = createDatabase(environment.DATABASE_URL, {
  applicationName: "swarmship-worker",
});
await runMigrations(database);
const agents = createSwarmShipAgents({
  executors,
  model: configuredModel.model,
});
const builds = new BuildRepository(database);
const leases = new LeaseRepository(database);
const specifications = new SpecificationRepository(database);
const verifications = new VerificationRepository(database);
const workerId = `worker-${randomUUID()}`;
const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

console.log(
  `SwarmShip worker ready with ${configuredModel.provider}/${configuredModel.modelName} and ${health.pollIntervalMs}ms polling`,
);

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
      const buildResult =
        result.status === "idle"
          ? await processOneBuild({
              builds,
              leaseSeconds: environment.WORKER_LEASE_SECONDS,
              leases,
              model: configuredModel.model,
              retrySeconds: environment.WORKER_RETRY_SECONDS,
              workerId,
            })
          : { status: "idle" as const };
      const verificationResult =
        result.status === "idle" && buildResult.status === "idle"
          ? await processOneVerification({
              leaseSeconds: environment.WORKER_LEASE_SECONDS,
              leases,
              model: configuredModel.model,
              retrySeconds: environment.WORKER_RETRY_SECONDS,
              verifications,
              workerId,
            })
          : { status: "idle" as const };
      if (result.status !== "idle") {
        console.log("SwarmShip worker step", result);
      } else if (buildResult.status !== "idle") {
        console.log("SwarmShip worker step", buildResult);
      } else if (verificationResult.status !== "idle") {
        console.log("SwarmShip worker step", verificationResult);
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
