import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import type { Address } from "viem";

import { ARBITRUM_SEPOLIA_CHAIN_ID } from "./hero-abi.js";
import type { HeroPublicClient } from "./clients.js";
import { HeroChainError } from "./errors.js";
import { STYLUS_DEPLOYER_ABI, STYLUS_DEPLOYER_ADDRESS } from "./stylus-abi.js";
import {
  confirmStylusDeployment,
  deploymentAddressFromReceipt,
} from "./stylus-reader.js";
import type {
  PreparedStylusDeployment,
  StylusDeploymentReconciliation,
} from "./types.js";

const MAX_RECONCILIATION_BLOCKS = 10_000n;

export async function prepareStylusDeployment(
  client: HeroPublicClient,
  sender: Address,
): Promise<PreparedStylusDeployment> {
  const [chainId, deployerCode, balance, startBlock, nonce] = await Promise.all(
    [
      client.getChainId(),
      client.getCode({ address: STYLUS_DEPLOYER_ADDRESS }),
      client.getBalance({ address: sender }),
      client.getBlockNumber(),
      client.getTransactionCount({ address: sender, blockTag: "pending" }),
    ],
  );
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new HeroChainError("wrong_chain", "Expected Arbitrum Sepolia.");
  }
  if (deployerCode === undefined || deployerCode === "0x") {
    throw new HeroChainError(
      "deployer_not_available",
      "The Stylus constructor deployer is unavailable.",
    );
  }
  if (balance === 0n) {
    throw new HeroChainError(
      "insufficient_relayer_balance",
      "The deployment relayer has no Arbitrum Sepolia ETH.",
    );
  }
  return { nonce, sender, startBlock };
}

export async function isStylusDeploymentPreparationCurrent(
  client: HeroPublicClient,
  prepared: PreparedStylusDeployment,
): Promise<boolean> {
  const [blockNumber, nonce] = await Promise.all([
    client.getBlockNumber(),
    client.getTransactionCount({
      address: prepared.sender,
      blockTag: "pending",
    }),
  ]);
  return blockNumber >= prepared.startBlock && nonce === prepared.nonce;
}

export async function reconcileStylusDeployment(
  client: HeroPublicClient,
  input: {
    nonce: number;
    requiredObservationBlock: bigint;
    sender: Address;
    specification: TaskRegistrySpecV1;
    startBlock: bigint;
  },
): Promise<StylusDeploymentReconciliation> {
  if (
    input.startBlock < 0n ||
    input.requiredObservationBlock < input.startBlock ||
    input.requiredObservationBlock - input.startBlock >
      MAX_RECONCILIATION_BLOCKS
  ) {
    throw new HeroChainError(
      "invalid_reconciliation_range",
      "Deployment reconciliation must use at most 10,000 ordered blocks.",
    );
  }
  try {
    const observedBlock = await client.getBlockNumber();
    if (observedBlock < input.requiredObservationBlock) {
      return {
        status: "inconclusive",
        observedBlock,
        reason: "observation_block_not_reached",
      };
    }
    const upper =
      observedBlock - input.startBlock > MAX_RECONCILIATION_BLOCKS
        ? input.startBlock + MAX_RECONCILIATION_BLOCKS
        : observedBlock;
    const logs = await client.getLogs({
      address: STYLUS_DEPLOYER_ADDRESS,
      event: STYLUS_DEPLOYER_ABI[0],
      fromBlock: input.startBlock,
      toBlock: upper,
    });
    for (const log of logs) {
      if (log.transactionHash === null) continue;
      const transaction = await client.getTransaction({
        hash: log.transactionHash,
      });
      if (
        transaction.from.toLowerCase() !== input.sender.toLowerCase() ||
        transaction.nonce !== input.nonce
      ) {
        continue;
      }
      const receipt = await client.getTransactionReceipt({
        hash: transaction.hash,
      });
      if (receipt.status === "reverted")
        return { status: "missing", observedBlock };
      const address = deploymentAddressFromReceipt(receipt);
      if (address === null) return { status: "missing", observedBlock };
      const confirmation = await confirmStylusDeployment(
        client,
        transaction.hash,
        address,
        input.specification,
      );
      if (confirmation.status !== "confirmed") {
        return {
          status: "inconclusive",
          observedBlock,
          reason: "configuration_mismatch",
        };
      }
      return {
        status: "present",
        contractAddress: address,
        observedBlock,
        transactionHash: transaction.hash,
      };
    }
    const pendingNonce = await client.getTransactionCount({
      address: input.sender,
      blockTag: "pending",
    });
    if (pendingNonce > input.nonce) {
      return {
        status: "inconclusive",
        observedBlock,
        reason: "transaction_not_found",
      };
    }
    return upper === observedBlock
      ? { status: "missing", observedBlock }
      : {
          status: "inconclusive",
          observedBlock,
          reason: "observation_block_not_reached",
        };
  } catch (error) {
    if (error instanceof HeroChainError) throw error;
    return {
      status: "inconclusive",
      observedBlock: null,
      reason: "rpc_unavailable",
    };
  }
}
