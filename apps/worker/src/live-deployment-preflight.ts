import {
  createHeroPublicClient,
  createHeroWalletClient,
} from "@swarmship/chain";
import { estimateApprovedStylusDeployment } from "@swarmship/deployer";
import {
  parseWorkerChainEnvironment,
  parseWorkerEnvironment,
} from "@swarmship/domain/environment";
import {
  closeDatabase,
  createDatabase,
  ReleaseRepository,
  runMigrations,
} from "@swarmship/persistence";

const NOW = 1_800_000_002;
const PUBLIC_ID = "release_manifest_anchor_smoke_v1";
const environment = parseWorkerChainEnvironment(process.env);
const workerEnvironment = parseWorkerEnvironment(process.env);
const publicClient = createHeroPublicClient(
  environment.ARBITRUM_SEPOLIA_RPC_URL,
);
const walletClient = createHeroWalletClient(
  environment.ARBITRUM_SEPOLIA_RPC_URL,
  environment.RELAYER_PRIVATE_KEY,
);
const account = walletClient.account;
if (account === undefined)
  throw new Error("The relayer account is unavailable.");
const database = createDatabase(workerEnvironment.DATABASE_URL, {
  applicationName: "swarmship-deployment-preflight",
});

try {
  await runMigrations(database);
  const releases = new ReleaseRepository(database);
  const [saved] = await database<{ id: string }[]>`
    SELECT id FROM releases WHERE public_id = ${PUBLIC_ID}
  `;
  const release = saved === undefined ? null : await releases.get(saved.id);
  if (
    release?.specification === null ||
    release?.specification === undefined ||
    release.buildEvidence === null ||
    release.verificationEvidence === null
  ) {
    throw new Error("The approved deployment evidence is unavailable.");
  }
  const [estimate, balance, nonce, blockNumber] = await Promise.all([
    estimateApprovedStylusDeployment({
      buildEvidence: release.buildEvidence,
      nowUnixSeconds: NOW,
      privateKey: environment.RELAYER_PRIVATE_KEY,
      rpcUrl: environment.ARBITRUM_SEPOLIA_RPC_URL,
      specification: release.specification,
      verificationEvidence: release.verificationEvidence,
    }),
    publicClient.getBalance({ address: account.address }),
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    publicClient.getBlockNumber(),
  ]);
  console.log(
    JSON.stringify({
      balanceWei: balance.toString(),
      blockNumber: blockNumber.toString(),
      estimate,
      nonce,
      releaseState: release.state,
    }),
  );
} finally {
  await closeDatabase(database);
}
