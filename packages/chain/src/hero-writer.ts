import { parseEventLogs, type Hash } from "viem";

import {
  HERO_PROOF_ANCHOR_ABI,
  HERO_PROOF_ANCHOR_ADDRESS,
} from "./hero-abi.js";
import type { HeroPublicClient, HeroWalletClient } from "./clients.js";
import { HeroChainError } from "./errors.js";
import {
  inspectHeroDeployment,
  parseProofRoot,
  verifyHeroProof,
} from "./hero-reader.js";
import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  PreparedHeroAnchor,
} from "./types.js";

export async function prepareHeroAnchor(
  publicClient: HeroPublicClient,
  walletClient: HeroWalletClient,
  rootInput: string,
): Promise<HeroAnchorPreparation> {
  const proofRoot = parseProofRoot(rootInput);
  await inspectHeroDeployment(publicClient);
  const existing = await verifyHeroProof(publicClient, proofRoot);
  if (existing.anchored) return { kind: "already_anchored", proof: existing };

  const account = walletClient.account;
  if (account === undefined) {
    throw new HeroChainError(
      "missing_wallet_account",
      "Relayer wallet account is missing.",
    );
  }
  const [startBlock, nonce] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
  ]);
  await publicClient.simulateContract({
    account,
    address: HERO_PROOF_ANCHOR_ADDRESS,
    abi: HERO_PROOF_ANCHOR_ABI,
    functionName: "anchor",
    args: [proofRoot],
    nonce,
  });
  return {
    kind: "ready",
    proofRoot,
    sender: account.address,
    nonce,
    startBlock,
  };
}

export async function broadcastHeroAnchor(
  publicClient: HeroPublicClient,
  walletClient: HeroWalletClient,
  prepared: PreparedHeroAnchor,
): Promise<HeroAnchorBroadcast> {
  const account = walletClient.account;
  if (account === undefined || account.address !== prepared.sender) {
    throw new HeroChainError(
      "missing_wallet_account",
      "Prepared relayer account is unavailable.",
    );
  }
  const existing = await verifyHeroProof(publicClient, prepared.proofRoot);
  if (existing.anchored) return { kind: "already_anchored", proof: existing };

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: HERO_PROOF_ANCHOR_ADDRESS,
      abi: HERO_PROOF_ANCHOR_ABI,
      functionName: "anchor",
      args: [prepared.proofRoot],
      nonce: prepared.nonce,
    });
    const transactionHash = await walletClient.writeContract(request);
    return { kind: "submitted", transactionHash };
  } catch (error) {
    const racedProof = await verifyHeroProof(publicClient, prepared.proofRoot);
    if (racedProof.anchored) {
      return { kind: "already_anchored", proof: racedProof };
    }
    throw error;
  }
}

export async function confirmHeroAnchor(
  publicClient: HeroPublicClient,
  proofRoot: string,
  transactionHash: Hash,
): Promise<HeroAnchorConfirmation> {
  const root = parseProofRoot(proofRoot);
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 2,
      timeout: 60_000,
    });
  } catch {
    return {
      status: "unknown",
      transactionHash,
      reason: "receipt_unavailable",
    };
  }
  if (receipt.status === "reverted") {
    return {
      status: "reverted",
      transactionHash,
      blockNumber: receipt.blockNumber,
    };
  }

  const events = parseEventLogs({
    abi: HERO_PROOF_ANCHOR_ABI,
    logs: receipt.logs,
    eventName: "ProofAnchored",
    strict: true,
  });
  const matchingEvent = events.find(
    (event) =>
      event.address.toLowerCase() === HERO_PROOF_ANCHOR_ADDRESS.toLowerCase() &&
      event.args.proofRoot === root,
  );
  if (matchingEvent === undefined) {
    return {
      status: "unknown",
      transactionHash,
      reason: "proof_event_missing",
    };
  }

  try {
    const proof = await verifyHeroProof(publicClient, root);
    if (!proof.anchored) {
      return {
        status: "unknown",
        transactionHash,
        reason: "proof_read_failed",
      };
    }
    if (
      proof.submitter !== matchingEvent.args.submitter ||
      proof.timestamp !== matchingEvent.args.timestamp
    ) {
      return { status: "unknown", transactionHash, reason: "proof_mismatch" };
    }
    return {
      status: "confirmed",
      transactionHash,
      blockNumber: receipt.blockNumber,
      logIndex: matchingEvent.logIndex,
      proof,
    };
  } catch {
    return { status: "unknown", transactionHash, reason: "proof_read_failed" };
  }
}
