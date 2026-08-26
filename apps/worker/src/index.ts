import { randomUUID } from "node:crypto";

import {
  createConfiguredAgentModel,
  createSwarmShipAgents,
  type AgentToolExecutors,
} from "@swarmship/agents";
import {
  broadcastHeroAnchor,
  confirmHeroAnchor,
  createHeroPublicClient,
  createHeroWalletClient,
  prepareHeroAnchor,
  reconcileHeroAnchor,
  verifyHeroProof,
} from "@swarmship/chain";
import {
  parseWorkerChainEnvironment,
  parseWorkerEnvironment,
} from "@swarmship/domain/environment";
import {
  BuildRepository,
  closeDatabase,
  createDatabase,
  LeaseRepository,
  ManifestAnchorRepository,
  DeploymentRepository,
  ReceiptAnchorRepository,
  runMigrations,
  SpecificationRepository,
  VerificationRepository,
} from "@swarmship/persistence";

import { processOneBuild } from "./build-processor.js";
import { processOneDeployment } from "./deployment-processor.js";
import { createDeploymentRuntime } from "./deployment-runtime.js";
import { getWorkerHealth } from "./health.js";
import { processOneManifestAnchor } from "./manifest-anchor-processor.js";
import { processOneSpecification } from "./specification-processor.js";
import { processOneVerification } from "./verification-processor.js";
import { processOneWitness } from "./witness-processor.js";
import { createWitnessRuntime } from "./witness-runtime.js";

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
const chainEnvironment = parseWorkerChainEnvironment(process.env);
const health = getWorkerHealth(environment);
const configuredModel = createConfiguredAgentModel(process.env);
const heroPublicClient = createHeroPublicClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
);
const heroWalletClient = createHeroWalletClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
  chainEnvironment.RELAYER_PRIVATE_KEY,
);
const witnessPublicClient = createHeroPublicClient(
  chainEnvironment.ARBITRUM_SEPOLIA_WITNESS_RPC_URL,
);
const database = createDatabase(environment.DATABASE_URL, {
  applicationName: "swarmship-worker",
});
await runMigrations(database);
const agents = createSwarmShipAgents({
  executors,
  model: configuredModel.model,
});
const builds = new BuildRepository(database);
const deployments = new DeploymentRepository(database);
const leases = new LeaseRepository(database);
const manifestAnchors = new ManifestAnchorRepository(database);
const receiptAnchors = new ReceiptAnchorRepository(database);
const specifications = new SpecificationRepository(database);
const verifications = new VerificationRepository(database);
const workerId = `worker-${randomUUID()}`;
const deploymentRuntime = createDeploymentRuntime({
  chainEnvironment,
  deployments,
  leaseSeconds: environment.WORKER_LEASE_SECONDS,
  leases,
  model: configuredModel.model,
  officialClient: heroPublicClient,
  retrySeconds: environment.WORKER_RETRY_SECONDS,
  walletClient: heroWalletClient,
  workerId,
});
const witnessRuntime = createWitnessRuntime({
  chainEnvironment,
  leaseSeconds: environment.WORKER_LEASE_SECONDS,
  leases,
  model: configuredModel.model,
  officialClient: heroPublicClient,
  receipts: receiptAnchors,
  retrySeconds: environment.WORKER_RETRY_SECONDS,
  walletClient: heroWalletClient,
  witnessClient: witnessPublicClient,
  workerId,
});
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
      const manifestAnchorResult =
        result.status === "idle" &&
        buildResult.status === "idle" &&
        verificationResult.status === "idle"
          ? await processOneManifestAnchor({
              anchors: manifestAnchors,
              broadcast: (prepared) =>
                broadcastHeroAnchor(
                  heroPublicClient,
                  heroWalletClient,
                  prepared,
                ),
              confirm: (proofRoot, transactionHash) =>
                confirmHeroAnchor(heroPublicClient, proofRoot, transactionHash),
              leaseSeconds: environment.WORKER_LEASE_SECONDS,
              leases,
              model: configuredModel.model,
              prepare: (proofRoot) =>
                prepareHeroAnchor(
                  heroPublicClient,
                  heroWalletClient,
                  proofRoot,
                ),
              reconcile: (input) =>
                reconcileHeroAnchor(heroPublicClient, input),
              retrySeconds: environment.WORKER_RETRY_SECONDS,
              verify: (proofRoot) =>
                verifyHeroProof(heroPublicClient, proofRoot),
              workerId,
            })
          : { status: "idle" as const };
      const deploymentResult =
        result.status === "idle" &&
        buildResult.status === "idle" &&
        verificationResult.status === "idle" &&
        manifestAnchorResult.status === "idle"
          ? await processOneDeployment({
              ...deploymentRuntime,
            })
          : { status: "idle" as const };
      const witnessResult =
        result.status === "idle" &&
        buildResult.status === "idle" &&
        verificationResult.status === "idle" &&
        manifestAnchorResult.status === "idle" &&
        deploymentResult.status === "idle"
          ? await processOneWitness(witnessRuntime)
          : { status: "idle" as const };
      if (result.status !== "idle") {
        console.log("SwarmShip worker step", result);
      } else if (buildResult.status !== "idle") {
        console.log("SwarmShip worker step", buildResult);
      } else if (verificationResult.status !== "idle") {
        console.log("SwarmShip worker step", verificationResult);
      } else if (manifestAnchorResult.status !== "idle") {
        console.log("SwarmShip worker step", manifestAnchorResult);
      } else if (deploymentResult.status !== "idle") {
        console.log("SwarmShip worker step", deploymentResult);
      } else if (witnessResult.status !== "idle") {
        console.log("SwarmShip worker step", witnessResult);
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
