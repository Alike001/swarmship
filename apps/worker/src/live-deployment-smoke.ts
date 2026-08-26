import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import {
  confirmStylusDeployment,
  createHeroPublicClient,
  createHeroWalletClient,
  isStylusDeploymentPreparationCurrent,
  prepareStylusDeployment,
  reconcileStylusDeployment,
} from "@swarmship/chain";
import {
  runApprovedStylusDeployment,
  type StylusDeploymentResult,
  type StylusVerificationResult,
  verifyApprovedStylusDeployment,
} from "@swarmship/deployer";
import {
  parseWorkerChainEnvironment,
  parseWorkerEnvironment,
} from "@swarmship/domain/environment";
import {
  closeDatabase,
  createDatabase,
  DeploymentRepository,
  LeaseRepository,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";
import {
  reconstructApprovedArtifact,
  removeSourceWorkspace,
} from "@swarmship/verifier";

import { processOneDeployment } from "./deployment-processor.js";

const NOW = 1_800_000_002;
const PUBLIC_ID = "release_manifest_anchor_smoke_v1";

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function deploymentModel(): ScriptedModel {
  const turn = (callId: string) => [
    response({
      arguments: "{}",
      callId,
      name: "request_guarded_deployment",
      status: "completed" as const,
      type: "function_call" as const,
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "The guarded Rust Stylus deployment step completed.",
          }),
          type: "output_text" as const,
        },
      ],
      role: "assistant" as const,
      status: "completed" as const,
      type: "message" as const,
    }),
  ];
  return new ScriptedModel([
    ...turn("deployment-prepare"),
    ...turn("deployment-run"),
    ...turn("deployment-reconcile"),
    ...turn("deployment-confirm"),
  ]);
}

const chainEnvironment = parseWorkerChainEnvironment(process.env);
const workerEnvironment = parseWorkerEnvironment(process.env);
const publicClient = createHeroPublicClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
);
const walletClient = createHeroWalletClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
  chainEnvironment.RELAYER_PRIVATE_KEY,
);
const account = walletClient.account;
if (account === undefined)
  throw new Error("The relayer account is unavailable.");
const database = createDatabase(workerEnvironment.DATABASE_URL, {
  applicationName: "swarmship-deployment-smoke",
});

try {
  await runMigrations(database);
  const releases = new ReleaseRepository(database);
  const deployments = new DeploymentRepository(database);
  const leases = new LeaseRepository(database);
  const [saved] = await database<{ id: string }[]>`
    SELECT id FROM releases WHERE public_id = ${PUBLIC_ID}
  `;
  if (saved === undefined) {
    throw new Error("Run the guarded manifest smoke before deployment.");
  }
  const scopedLeases = {
    claimNext: (
      workerId: string,
      durationSeconds: number,
      states: Parameters<LeaseRepository["claimNext"]>[2],
      reconciliationKinds: Parameters<LeaseRepository["claimNext"]>[3],
    ) =>
      leases.claimById(
        saved.id,
        workerId,
        durationSeconds,
        states,
        reconciliationKinds,
      ),
    defer: leases.defer.bind(leases),
    renew: leases.renew.bind(leases),
  };
  const model = deploymentModel();
  let lastDeploymentResult: StylusDeploymentResult | null = null;
  let lastVerificationResult: StylusVerificationResult | null = null;
  const process = () =>
    processOneDeployment({
      confirm: (transactionHash, contractAddress, release) => {
        if (release.specification === null) {
          throw new Error("Approved specification is missing.");
        }
        return confirmStylusDeployment(
          publicClient,
          transactionHash,
          contractAddress,
          release.specification,
        );
      },
      deploy: async (release, nowUnixSeconds) => {
        if (
          release.specification === null ||
          release.buildEvidence === null ||
          release.verificationEvidence === null
        ) {
          throw new Error("Approved deployment evidence is missing.");
        }
        lastDeploymentResult = await runApprovedStylusDeployment({
          buildEvidence: release.buildEvidence,
          nowUnixSeconds,
          privateKey: chainEnvironment.RELAYER_PRIVATE_KEY,
          rpcUrl: chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
          specification: release.specification,
          verificationEvidence: release.verificationEvidence,
        });
        return lastDeploymentResult;
      },
      deployments,
      leaseSeconds: 900,
      leases: scopedLeases,
      model,
      nowUnixSeconds: () => NOW,
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
      prepareChain: () =>
        prepareStylusDeployment(publicClient, account.address),
      reconcile: (input, release) => {
        if (release.specification === null) {
          throw new Error("Approved specification is missing.");
        }
        return reconcileStylusDeployment(publicClient, {
          ...input,
          specification: release.specification,
        });
      },
      retrySeconds: 60,
      validateChain: (prepared) =>
        isStylusDeploymentPreparationCurrent(publicClient, prepared),
      verify: async (release, transactionHash, nowUnixSeconds) => {
        if (
          release.specification === null ||
          release.buildEvidence === null ||
          release.verificationEvidence === null
        ) {
          throw new Error("Approved deployment evidence is missing.");
        }
        lastVerificationResult = await verifyApprovedStylusDeployment({
          buildEvidence: release.buildEvidence,
          nowUnixSeconds,
          rpcUrl: chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
          specification: release.specification,
          transactionHash,
          verificationEvidence: release.verificationEvidence,
        });
        return lastVerificationResult;
      },
      workerId: "deployment-smoke",
    });

  const steps = [];
  for (let index = 0; index < 4; index += 1) {
    const current = await releases.get(saved.id);
    if (
      current === null ||
      ![
        "approved_not_deployed",
        "deploying",
        "reconciliation_required",
      ].includes(current.state)
    ) {
      break;
    }
    const step = await process();
    steps.push(step);
    if (
      step.status !== "processed" ||
      step.event === "deployment_verification_rejected"
    ) {
      break;
    }
  }
  const release = await releases.get(saved.id);
  console.log(
    JSON.stringify({
      artifactHash: release?.deploymentAttempt?.artifactHash ?? null,
      contractAddress: release?.deploymentAttempt?.contractAddress ?? null,
      lastDeploymentResult,
      lastVerificationResult,
      state: release?.state,
      steps,
      transactionHash: release?.deploymentAttempt?.transactionHash ?? null,
      verificationStatus:
        release?.deploymentAttempt?.verificationStatus ?? null,
    }),
  );
} finally {
  await closeDatabase(database);
}
