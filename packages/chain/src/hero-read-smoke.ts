import { keccak256, stringToHex } from "viem";

import { createHeroPublicClient } from "./clients.js";
import { inspectHeroDeployment, verifyHeroProof } from "./hero-reader.js";

const rpcUrl =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ??
  "https://sepolia-rollup.arbitrum.io/rpc";
const client = createHeroPublicClient(rpcUrl);
const inspection = await inspectHeroDeployment(client);
const probeRoot = keccak256(stringToHex("swarmship-read-only-probe-v1"));
const proof = await verifyHeroProof(client, probeRoot);

console.log(
  JSON.stringify({
    address: inspection.address,
    bytecodePresent: inspection.bytecode !== "0x",
    chainId: inspection.chainId,
    probeAnchored: proof.anchored,
    verifyDecoded: proof.timestamp >= 0n,
  }),
);
