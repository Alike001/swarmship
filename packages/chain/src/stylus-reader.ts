import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import {
  getAddress,
  parseEventLogs,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";

import type { HeroPublicClient } from "./clients.js";
import {
  AGENT_TASK_REGISTRY_ABI,
  ARB_WASM_ABI,
  ARB_WASM_ADDRESS,
  STYLUS_DEPLOYER_ABI,
  STYLUS_DEPLOYER_ADDRESS,
} from "./stylus-abi.js";
import type {
  StylusDeploymentConfirmation,
  StylusRegistryInspection,
} from "./types.js";

export function deploymentAddressFromReceipt(
  receipt: TransactionReceipt,
): Address | null {
  const events = parseEventLogs({
    abi: STYLUS_DEPLOYER_ABI,
    logs: receipt.logs,
    eventName: "ContractDeployed",
    strict: true,
  });
  const matches = events.filter(
    (event) =>
      event.address.toLowerCase() === STYLUS_DEPLOYER_ADDRESS.toLowerCase(),
  );
  return matches.length === 1
    ? getAddress(matches[0]!.args.deployedContract)
    : null;
}

export async function inspectStylusRegistry(
  client: HeroPublicClient,
  address: Address,
): Promise<StylusRegistryInspection> {
  const bytecode = await client.getCode({ address });
  if (bytecode === undefined || bytecode === "0x") {
    throw new Error("Deployed registry bytecode is missing.");
  }
  const read = <T>(functionName: string) =>
    client.readContract({
      address,
      abi: AGENT_TASK_REGISTRY_ABI,
      functionName: functionName as never,
    }) as Promise<T>;
  const [
    owner,
    permittedSender,
    permittedReceiver,
    maxHandoffs,
    expiry,
    handoffCount,
    activatedVersion,
  ] = await Promise.all([
    read<Address>("owner"),
    read<Address>("permittedSender"),
    read<Address>("permittedReceiver"),
    read<bigint>("maxHandoffs"),
    read<bigint>("expiry"),
    read<bigint>("handoffCount"),
    client.readContract({
      address: ARB_WASM_ADDRESS,
      abi: ARB_WASM_ABI,
      functionName: "programVersion",
      args: [address],
    }),
  ]);
  return {
    activatedVersion: Number(activatedVersion),
    address,
    bytecode,
    configuration: {
      expiry: Number(expiry),
      maxHandoffs: Number(maxHandoffs),
      owner: getAddress(owner),
      permittedReceiver: getAddress(permittedReceiver),
      permittedSender: getAddress(permittedSender),
    },
    handoffCount,
  };
}

function matchesSpecification(
  inspection: StylusRegistryInspection,
  specification: TaskRegistrySpecV1,
): boolean {
  return (
    inspection.activatedVersion > 0 &&
    inspection.handoffCount === 0n &&
    JSON.stringify(inspection.configuration) ===
      JSON.stringify({
        expiry: specification.expiry,
        maxHandoffs: specification.maxHandoffs,
        owner: specification.owner,
        permittedReceiver: specification.permittedReceiver,
        permittedSender: specification.permittedSender,
      })
  );
}

export async function confirmStylusDeployment(
  client: HeroPublicClient,
  transactionHash: Hash,
  expectedAddress: Address,
  specification: TaskRegistrySpecV1,
): Promise<StylusDeploymentConfirmation> {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 2,
      timeout: 90_000,
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
      blockNumber: receipt.blockNumber,
      transactionHash,
    };
  }
  const deployedAddress = deploymentAddressFromReceipt(receipt);
  if (deployedAddress === null) {
    return {
      status: "unknown",
      transactionHash,
      reason: "deployment_event_missing",
    };
  }
  if (deployedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { status: "unknown", transactionHash, reason: "address_mismatch" };
  }
  try {
    const inspection = await inspectStylusRegistry(client, deployedAddress);
    if (!matchesSpecification(inspection, specification)) {
      return {
        status: "unknown",
        transactionHash,
        reason: "configuration_mismatch",
      };
    }
    return {
      status: "confirmed",
      blockNumber: receipt.blockNumber,
      inspection,
      transactionHash,
    };
  } catch {
    return {
      status: "unknown",
      transactionHash,
      reason: "registry_read_failed",
    };
  }
}
