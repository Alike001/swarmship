import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import { WitnessToolRouterModel } from "@swarmship/agents";
import {
  broadcastHeroAnchor,
  confirmHeroAnchor,
  createHeroPublicClient,
  createHeroWalletClient,
  inspectHeroDeployment,
  observeStylusRelease,
  prepareHeroAnchor,
  reconcileHeroAnchor,
  verifyHeroProof,
} from "@swarmship/chain";
import { verifyApprovedStylusDeployment } from "@swarmship/deployer";
import {
  parseWorkerChainEnvironment,
  parseWorkerEnvironment,
} from "@swarmship/domain/environment";
import {
  closeDatabase,
  createDatabase,
  LeaseRepository,
  ReceiptAnchorRepository,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";

import { processOneWitness } from "./witness-processor.js";

const NOW = 1_800_000_004;
const PUBLIC_ID =
  process.env.LIVE_RELEASE_PUBLIC_ID ?? "release_manifest_anchor_smoke_v1";
const isProductionRelease = process.env.LIVE_RELEASE_PUBLIC_ID !== undefined;

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function witnessModel(): ScriptedModel {
  const turn = (callId: string) => [
    response({
      arguments: "{}",
      callId,
      name: "read_independent_evidence",
      status: "completed" as const,
      type: "function_call" as const,
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "The independent Witness step completed.",
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
    ...turn("witness-observe"),
    ...turn("receipt-anchor"),
    ...turn("receipt-reconcile"),
  ]);
}

const chainEnvironment = parseWorkerChainEnvironment(process.env);
const workerEnvironment = parseWorkerEnvironment(process.env);
const officialClient = createHeroPublicClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
);
const witnessClient = createHeroPublicClient(
  chainEnvironment.ARBITRUM_SEPOLIA_WITNESS_RPC_URL,
);
const walletClient = createHeroWalletClient(
  chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
  chainEnvironment.RELAYER_PRIVATE_KEY,
);
const database = createDatabase(workerEnvironment.DATABASE_URL, {
  applicationName: "swarmship-witness-smoke",
});

try {
  await runMigrations(database);
  const releases = new ReleaseRepository(database);
  const receipts = new ReceiptAnchorRepository(database);
  const leases = new LeaseRepository(database);
  const [saved] = await database<{ id: string }[]>`
    SELECT id FROM releases WHERE public_id = ${PUBLIC_ID}
  `;
  if (saved === undefined) {
    throw new Error("Run the verified deployment smoke before Witness.");
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
  const process = () =>
    processOneWitness({
      broadcast: (prepared) =>
        broadcastHeroAnchor(officialClient, walletClient, prepared),
      confirm: (root, transactionHash) =>
        confirmHeroAnchor(officialClient, root, transactionHash),
      inspectOfficial: () => inspectHeroDeployment(officialClient),
      inspectWitness: () => inspectHeroDeployment(witnessClient),
      leaseSeconds: 900,
      leases: scopedLeases,
      model: isProductionRelease
        ? new WitnessToolRouterModel()
        : witnessModel(),
      nowUnixSeconds: () =>
        isProductionRelease ? Math.floor(Date.now() / 1_000) : NOW,
      observeDeployment: (release) => {
        const attempt = release.deploymentAttempt;
        if (
          release.specification === null ||
          attempt === null ||
          attempt.transactionHash === null ||
          attempt.contractAddress === null
        ) {
          throw new Error("Witness deployment evidence is missing.");
        }
        return observeStylusRelease(
          witnessClient,
          attempt.transactionHash,
          attempt.contractAddress,
          release.specification,
        );
      },
      prepare: (root) => prepareHeroAnchor(officialClient, walletClient, root),
      receipts,
      reconcileOfficial: (input) => reconcileHeroAnchor(officialClient, input),
      reconcileWitness: (input) => reconcileHeroAnchor(witnessClient, input),
      retrySeconds: 60,
      verifyManifestWitness: (root) => verifyHeroProof(witnessClient, root),
      verifyReceiptOfficial: (root) => verifyHeroProof(officialClient, root),
      verifyReceiptWitness: (root) => verifyHeroProof(witnessClient, root),
      verifySource: (release) => {
        const attempt = release.deploymentAttempt;
        if (
          release.specification === null ||
          release.buildEvidence === null ||
          release.verificationEvidence === null ||
          release.manifestApproval === null ||
          attempt === null ||
          attempt.transactionHash === null
        ) {
          throw new Error("Witness source evidence is missing.");
        }
        return verifyApprovedStylusDeployment({
          buildEvidence: release.buildEvidence,
          nowUnixSeconds: release.manifestApproval.approvedAt,
          rpcUrl: chainEnvironment.ARBITRUM_SEPOLIA_WITNESS_RPC_URL,
          specification: release.specification,
          transactionHash: attempt.transactionHash,
          verificationEvidence: release.verificationEvidence,
        });
      },
      workerId: isProductionRelease
        ? "witness-production-recovery"
        : "witness-smoke",
    });

  const steps = [];
  for (let index = 0; index < 3; index += 1) {
    const current = await releases.get(saved.id);
    if (
      current === null ||
      ![
        "deployed_unverified",
        "anchoring_receipt",
        "reconciliation_required",
      ].includes(current.state)
    ) {
      break;
    }
    const step = await process();
    steps.push(step);
    if (step.status !== "processed" || step.event === "witness_rejected") {
      break;
    }
  }
  const release = await releases.get(saved.id);
  const receiptRoot = release?.receiptEvidence?.receiptRoot ?? null;
  const [officialProof, witnessProof] =
    receiptRoot === null
      ? [null, null]
      : await Promise.all([
          verifyHeroProof(officialClient, receiptRoot),
          verifyHeroProof(witnessClient, receiptRoot),
        ]);
  console.log(
    JSON.stringify({
      anchorTransactionHash:
        release?.receiptAnchorAttempt?.transactionHash ?? null,
      contractAddress:
        release?.receiptEvidence?.receipt.deployedAddress ?? null,
      deploymentTransaction:
        release?.receiptEvidence?.receipt.deploymentTransaction ?? null,
      officialAnchored: officialProof?.anchored ?? false,
      receiptRoot,
      state: release?.state,
      steps,
      witnessAnchored: witnessProof?.anchored ?? false,
      witnessChainId: release?.receiptEvidence?.witnessChainId ?? null,
    }),
  );
} finally {
  await closeDatabase(database);
}
