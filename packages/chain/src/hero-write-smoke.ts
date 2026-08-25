import { formatEther, keccak256, stringToHex, type Hex } from "viem";

import { createHeroPublicClient, createHeroWalletClient } from "./clients.js";
import { inspectHeroDeployment, verifyHeroProof } from "./hero-reader.js";
import {
  broadcastHeroAnchor,
  confirmHeroAnchor,
  prepareHeroAnchor,
} from "./hero-writer.js";

const SMOKE_ROOT_LABEL =
  "swarmship:hero-write-smoke:v1:repo-1346099318:issue-7";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredPrivateKey(): Hex {
  const privateKey = requiredEnvironment("RELAYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("RELAYER_PRIVATE_KEY must be exactly 32 bytes.");
  }
  return privateKey as Hex;
}

const rpcUrl = requiredEnvironment("ARBITRUM_SEPOLIA_RPC_URL");
const witnessRpcUrl = requiredEnvironment("ARBITRUM_SEPOLIA_WITNESS_RPC_URL");
const privateKey = requiredPrivateKey();

const publicClient = createHeroPublicClient(rpcUrl);
const witnessClient = createHeroPublicClient(witnessRpcUrl);
const walletClient = createHeroWalletClient(rpcUrl, privateKey);
const account = walletClient.account;
if (!account) throw new Error("The relayer account is unavailable.");

const proofRoot = keccak256(stringToHex(SMOKE_ROOT_LABEL));
const [officialDeployment, witnessDeployment, balance] = await Promise.all([
  inspectHeroDeployment(publicClient),
  inspectHeroDeployment(witnessClient),
  publicClient.getBalance({ address: account.address }),
]);
if (balance === 0n) throw new Error("The relayer has no Arbitrum Sepolia ETH.");

const preparation = await prepareHeroAnchor(
  publicClient,
  walletClient,
  proofRoot,
);
let transactionHash: `0x${string}` | null = null;
let confirmationStatus = "already_anchored";

if (preparation.kind === "ready") {
  const broadcast = await broadcastHeroAnchor(
    publicClient,
    walletClient,
    preparation,
  );
  if (broadcast.kind === "submitted") {
    transactionHash = broadcast.transactionHash;
    const confirmation = await confirmHeroAnchor(
      publicClient,
      proofRoot,
      transactionHash,
    );
    if (confirmation.status !== "confirmed") {
      throw new Error(`HERŌ anchor confirmation was ${confirmation.status}.`);
    }
    confirmationStatus = confirmation.status;
  }
}

const [officialProof, witnessProof, duplicatePreparation] = await Promise.all([
  verifyHeroProof(publicClient, proofRoot),
  verifyHeroProof(witnessClient, proofRoot),
  prepareHeroAnchor(publicClient, walletClient, proofRoot),
]);
if (!officialProof.anchored || !witnessProof.anchored) {
  throw new Error("The proof was not visible through both RPC providers.");
}
if (
  officialProof.submitter.toLowerCase() !== account.address.toLowerCase() ||
  witnessProof.submitter.toLowerCase() !== account.address.toLowerCase()
) {
  throw new Error("The verified proof submitter does not match the relayer.");
}
if (duplicatePreparation.kind !== "already_anchored") {
  throw new Error("The duplicate proof was not recovered without rebroadcast.");
}

console.log(
  JSON.stringify({
    balanceEth: formatEther(balance),
    chainId: officialDeployment.chainId,
    confirmationStatus,
    duplicateResult: duplicatePreparation.kind,
    heroAddress: officialDeployment.address,
    proofRoot,
    relayer: account.address,
    transactionHash,
    verifyTimestamp: officialProof.timestamp.toString(),
    witnessChainId: witnessDeployment.chainId,
  }),
);
