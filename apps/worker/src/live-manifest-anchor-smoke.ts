import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import { renderTaskRegistry } from "@swarmship/builder";
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
import { toReleaseManifestTypedData } from "@swarmship/domain/release";
import {
  ApprovalRepository,
  closeDatabase,
  createDatabase,
  LeaseRepository,
  ManifestAnchorRepository,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";
import { verifyTaskRegistry } from "@swarmship/verifier";

import { processOneManifestAnchor } from "./manifest-anchor-processor.js";

const NOW = 1_800_000_000;
const PUBLIC_ID = "release_manifest_anchor_smoke_v1";
const EXPECTED_ROOT =
  "0x069cac31c40fd9c624c80e8320ee30e741e4a141229368b17ea2944ff10454d3";

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function anchorModel(): ScriptedModel {
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
            summary: "The guarded HERŌ manifest step completed.",
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
    ...turn("manifest-prepare"),
    ...turn("manifest-confirm"),
    ...turn("manifest-reconcile"),
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
const owner = walletClient.account;
if (owner === undefined) throw new Error("The relayer account is unavailable.");
const database = createDatabase(workerEnvironment.DATABASE_URL, {
  applicationName: "swarmship-manifest-anchor-smoke",
});

try {
  await runMigrations(database);
  const releases = new ReleaseRepository(database);
  const approvals = new ApprovalRepository(database);
  const anchors = new ManifestAnchorRepository(database);
  const leases = new LeaseRepository(database);
  const [saved] = await database<{ id: string }[]>`
    SELECT id FROM releases WHERE public_id = ${PUBLIC_ID}
  `;
  let releaseId = saved?.id;
  if (releaseId === undefined) {
    const specification = {
      contractFamily: "agent-task-registry-v1" as const,
      expiry: 2_000_000_000,
      maxHandoffs: 5,
      owner: owner.address,
      permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
      permittedSender: "0x0000000000000000000000000000000000000002" as const,
    };
    const build = await renderTaskRegistry(specification, NOW);
    const verification = await verifyTaskRegistry(build, specification, NOW);
    if (verification.status !== "passed") {
      const failures = verification.checks
        .filter((check) => check.status === "failed")
        .map((check) => check.name)
        .join(",");
      throw new Error(
        `The real release verification did not pass: ${failures || "artifact_missing"}.`,
      );
    }
    const created = await releases.create({
      originalRequest: "Create the fixed guarded task registry.",
    });
    releaseId = created.release.id;
    await database`
      UPDATE releases
      SET public_id = ${PUBLIC_ID},
          state = 'awaiting_approval',
          version = 3,
          specification = ${database.json(specification)},
          build_evidence = ${database.json(build)},
          verification_evidence = ${database.json(verification)},
          updated_at = to_timestamp(${NOW})
      WHERE id = ${releaseId}
    `;
    const pending = await approvals.getRequest(releaseId, NOW + 1);
    const signature = await owner.signTypedData(
      toReleaseManifestTypedData(pending.manifest),
    );
    await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId,
      signature,
    });
  }
  const request = await approvals.getRequest(releaseId, NOW + 2);
  if (request.digest !== EXPECTED_ROOT) {
    throw new Error("The rebuilt release differs from the anchored manifest.");
  }

  const model = anchorModel();
  const process = () =>
    processOneManifestAnchor({
      anchors,
      broadcast: (prepared) =>
        broadcastHeroAnchor(publicClient, walletClient, prepared),
      confirm: (root, transactionHash) =>
        confirmHeroAnchor(publicClient, root, transactionHash),
      leaseSeconds: 180,
      leases,
      model,
      nowUnixSeconds: () => NOW + 2,
      prepare: (root) => prepareHeroAnchor(publicClient, walletClient, root),
      reconcile: (input) => reconcileHeroAnchor(publicClient, input),
      retrySeconds: 60,
      verify: (root) => verifyHeroProof(publicClient, root),
      workerId: "manifest-anchor-smoke",
    });

  const steps = [];
  for (let index = 0; index < 3; index += 1) {
    const current = await releases.get(releaseId);
    if (
      current === null ||
      !["approved", "anchoring_manifest", "reconciliation_required"].includes(
        current.state,
      )
    ) {
      break;
    }
    const step = await process();
    steps.push(step);
    if (step.status !== "processed") break;
  }
  const release = await releases.get(releaseId);
  const proof = await verifyHeroProof(publicClient, request.digest);

  console.log(
    JSON.stringify({
      digest: request.digest,
      proof: {
        anchored: proof.anchored,
        proofRoot: proof.proofRoot,
        submitter: proof.submitter,
        timestamp: proof.timestamp.toString(),
      },
      state: release?.state,
      steps,
      transactionHash: release?.manifestAnchorAttempt?.transactionHash ?? null,
    }),
  );
} finally {
  await closeDatabase(database);
}
