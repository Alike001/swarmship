import {
  HERO_PROOF_ANCHOR_ABI,
  HERO_PROOF_ANCHOR_ADDRESS,
} from "./hero-abi.js";
import type { HeroPublicClient } from "./clients.js";
import { HeroChainError } from "./errors.js";
import {
  isEmptyProofRecord,
  parseProofRoot,
  verifyHeroProof,
} from "./hero-reader.js";
import type { HeroAnchorReconciliation } from "./types.js";

const MAX_RECONCILIATION_BLOCKS = 10_000n;

export async function reconcileHeroAnchor(
  client: HeroPublicClient,
  input: {
    proofRoot: string;
    startBlock: bigint;
    requiredObservationBlock: bigint;
  },
): Promise<HeroAnchorReconciliation> {
  const proofRoot = parseProofRoot(input.proofRoot);
  if (
    input.startBlock < 0n ||
    input.requiredObservationBlock < input.startBlock ||
    input.requiredObservationBlock - input.startBlock >
      MAX_RECONCILIATION_BLOCKS
  ) {
    throw new HeroChainError(
      "invalid_reconciliation_range",
      "Reconciliation must use an ordered block range of at most 10,000 blocks.",
    );
  }

  try {
    const [proof, observedBlock] = await Promise.all([
      verifyHeroProof(client, proofRoot),
      client.getBlockNumber(),
    ]);
    if (proof.anchored) return { status: "present", observedBlock, proof };
    if (!isEmptyProofRecord(proof)) {
      return {
        status: "inconclusive",
        observedBlock,
        reason: "inconsistent_evidence",
      };
    }
    if (observedBlock < input.requiredObservationBlock) {
      return {
        status: "inconclusive",
        observedBlock,
        reason: "observation_block_not_reached",
      };
    }

    const events = await client.getContractEvents({
      address: HERO_PROOF_ANCHOR_ADDRESS,
      abi: HERO_PROOF_ANCHOR_ABI,
      eventName: "ProofAnchored",
      args: { proofRoot },
      fromBlock: input.startBlock,
      toBlock: observedBlock,
      strict: true,
    });
    if (events.length > 0) {
      return {
        status: "inconclusive",
        observedBlock,
        reason: "inconsistent_evidence",
      };
    }
    return { status: "missing", observedBlock };
  } catch (error) {
    if (error instanceof HeroChainError) throw error;
    return {
      status: "inconclusive",
      observedBlock: null,
      reason: "rpc_unavailable",
    };
  }
}
