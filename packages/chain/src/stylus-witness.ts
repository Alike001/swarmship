import { keccak256, type Address, type Hash } from "viem";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";

import { ARBITRUM_SEPOLIA_CHAIN_ID } from "./hero-abi.js";
import type { HeroPublicClient } from "./clients.js";
import { confirmStylusDeployment } from "./stylus-reader.js";
import type { StylusWitnessObservation } from "./types.js";

export async function observeStylusRelease(
  client: HeroPublicClient,
  transactionHash: Hash,
  expectedAddress: Address,
  specification: TaskRegistrySpecV1,
): Promise<StylusWitnessObservation> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    return { status: "unknown", reason: "rpc_unavailable" };
  }
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    return { status: "mismatch", reason: "wrong_chain" };
  }

  const [confirmation, transaction] = await Promise.all([
    confirmStylusDeployment(
      client,
      transactionHash,
      expectedAddress,
      specification,
    ),
    client.getTransaction({ hash: transactionHash }).catch(() => null),
  ]);
  if (confirmation.status === "reverted") {
    return { status: "mismatch", reason: "deployment_reverted" };
  }
  if (confirmation.status === "unknown") {
    return {
      status:
        confirmation.reason === "deployment_event_missing" ||
        confirmation.reason === "address_mismatch" ||
        confirmation.reason === "configuration_mismatch"
          ? "mismatch"
          : "unknown",
      reason: confirmation.reason,
    };
  }
  if (transaction === null) {
    return { status: "unknown", reason: "transaction_unavailable" };
  }

  return {
    status: "confirmed",
    chainId,
    blockNumber: confirmation.blockNumber,
    codeHash: keccak256(confirmation.inspection.bytecode),
    inspection: confirmation.inspection,
    nonce: transaction.nonce,
    sender: transaction.from,
    transactionHash,
  };
}
