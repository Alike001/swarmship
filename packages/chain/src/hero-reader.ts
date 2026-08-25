import { zeroAddress, type Address } from "viem";

import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  HERO_PROOF_ANCHOR_ABI,
  HERO_PROOF_ANCHOR_ADDRESS,
} from "./hero-abi.js";
import type { HeroPublicClient } from "./clients.js";
import { HeroChainError } from "./errors.js";
import type {
  HeroDeploymentInspection,
  HeroProofRecord,
  ProofRoot,
} from "./types.js";

const PROOF_ROOT_PATTERN = /^0x[0-9a-f]{64}$/;

export function parseProofRoot(input: string): ProofRoot {
  if (!PROOF_ROOT_PATTERN.test(input) || /^0x0{64}$/.test(input)) {
    throw new HeroChainError(
      "invalid_root",
      "Proof root must be a non-zero lowercase bytes32 value.",
    );
  }
  return input as ProofRoot;
}

export async function inspectHeroDeployment(
  client: HeroPublicClient,
): Promise<HeroDeploymentInspection> {
  const chainId = await client.getChainId();
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new HeroChainError(
      "wrong_chain",
      `Expected Arbitrum Sepolia chain ${ARBITRUM_SEPOLIA_CHAIN_ID}.`,
    );
  }
  const bytecode = await client.getCode({ address: HERO_PROOF_ANCHOR_ADDRESS });
  if (bytecode === undefined || bytecode === "0x") {
    throw new HeroChainError(
      "anchor_not_deployed",
      "HERŌ proof anchor bytecode is missing at the configured address.",
    );
  }
  return { address: HERO_PROOF_ANCHOR_ADDRESS, chainId, bytecode };
}

export async function verifyHeroProof(
  client: HeroPublicClient,
  rootInput: string,
): Promise<HeroProofRecord> {
  const proofRoot = parseProofRoot(rootInput);
  const [anchored, timestamp, submitter] = await client.readContract({
    address: HERO_PROOF_ANCHOR_ADDRESS,
    abi: HERO_PROOF_ANCHOR_ABI,
    functionName: "verify",
    args: [proofRoot],
  });
  return {
    anchored,
    proofRoot,
    timestamp,
    submitter: submitter as Address,
  };
}

export function isEmptyProofRecord(record: HeroProofRecord): boolean {
  return (
    !record.anchored &&
    record.timestamp === 0n &&
    record.submitter === zeroAddress
  );
}
