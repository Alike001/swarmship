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
  confirmStylusDeployment,
  isStylusDeploymentPreparationCurrent,
  prepareStylusDeployment,
  reconcileStylusDeployment,
} from "@swarmship/chain";
import {
  runApprovedStylusDeployment,
  verifyApprovedStylusDeployment,
} from "@swarmship/deployer";
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
  runMigrations,
  SpecificationRepository,
  VerificationRepository,
} from "@swarmship/persistence";
import {
  reconstructApprovedArtifact,
  removeSourceWorkspace,
} from "@swarmship/verifier";

import { processOneBuild } from "./build-processor.js";
import { processOneDeployment } from "./deployment-processor.js";
import { getWorkerHealth } from "./health.js";
import { processOneManifestAnchor } from "./manifest-anchor-processor.js";
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
              confirm: (transactionHash, contractAddress, release) => {
                if (release.specification === null) {
                  throw new Error("Approved specification is missing.");
                }
                return confirmStylusDeployment(
                  heroPublicClient,
                  transactionHash,
                  contractAddress,
                  release.specification,
                );
              },
              deploy: (release, nowUnixSeconds) => {
                if (
                  release.specification === null ||
                  release.buildEvidence === null ||
                  release.verificationEvidence === null
                ) {
                  throw new Error("Approved deployment evidence is missing.");
                }
                return runApprovedStylusDeployment({
                  buildEvidence: release.buildEvidence,
                  nowUnixSeconds,
                  privateKey: chainEnvironment.RELAYER_PRIVATE_KEY,
                  rpcUrl: chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
                  specification: release.specification,
                  verificationEvidence: release.verificationEvidence,
                });
              },
              deployments,
              leaseSeconds: environment.WORKER_LEASE_SECONDS,
              leases,
              model: configuredModel.model,
              prepareArtifact: async (release, nowUnixSeconds) => {
                if (
                  release.specification === null ||
                  release.buildEvidence === null ||
                  release.verificationEvidence === null
                ) {
                  throw new Error("Approved deployment evidence is missing.");
                }
                const workspace = await reconstructApprovedArtifact(
                  release.buildEvidence,
                  release.verificationEvidence,
                  release.specification,
                  nowUnixSeconds,
                );
                await removeSourceWorkspace(workspace.root);
                return workspace.artifactHash;
              },
              prepareChain: () => {
                const account = heroWalletClient.account;
                if (account === undefined) {
                  throw new Error("Deployment relayer account is missing.");
                }
                return prepareStylusDeployment(
                  heroPublicClient,
                  account.address,
                );
              },
              reconcile: (input, release) => {
                if (release.specification === null) {
                  throw new Error("Approved specification is missing.");
                }
                return reconcileStylusDeployment(heroPublicClient, {
                  ...input,
                  specification: release.specification,
                });
              },
              retrySeconds: environment.WORKER_RETRY_SECONDS,
              verify: (release, transactionHash, nowUnixSeconds) => {
                if (
                  release.specification === null ||
                  release.buildEvidence === null ||
                  release.verificationEvidence === null
                ) {
                  throw new Error("Approved deployment evidence is missing.");
                }
                return verifyApprovedStylusDeployment({
                  buildEvidence: release.buildEvidence,
                  nowUnixSeconds,
                  rpcUrl: chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
                  specification: release.specification,
                  transactionHash,
                  verificationEvidence: release.verificationEvidence,
                });
              },
              validateChain: (prepared) =>
                isStylusDeploymentPreparationCurrent(
                  heroPublicClient,
                  prepared,
                ),
              workerId,
            })
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
