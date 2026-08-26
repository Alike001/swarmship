import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hash,
} from "viem";
import { describe, expect, it } from "vitest";

import { mockPublicClient, TEST_ACCOUNT } from "./test-clients.js";
import { STYLUS_DEPLOYER_ABI, STYLUS_DEPLOYER_ADDRESS } from "./stylus-abi.js";
import {
  confirmStylusDeployment,
  deploymentAddressFromReceipt,
} from "./stylus-reader.js";
import {
  isStylusDeploymentPreparationCurrent,
  prepareStylusDeployment,
  reconcileStylusDeployment,
} from "./stylus-reconciliation.js";

const CONTRACT = "0x0000000000000000000000000000000000000004" as Address;
const TRANSACTION = `0x${"5".repeat(64)}` as Hash;
const SPECIFICATION: TaskRegistrySpecV1 = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function deploymentLog() {
  return {
    address: STYLUS_DEPLOYER_ADDRESS,
    blockHash: `0x${"1".repeat(64)}`,
    blockNumber: 101n,
    data: encodeAbiParameters([{ type: "address" }], [CONTRACT]),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: STYLUS_DEPLOYER_ABI,
      eventName: "ContractDeployed",
    }),
    transactionHash: TRANSACTION,
    transactionIndex: 0,
  } as const;
}

function receipt(status: "success" | "reverted" = "success") {
  return {
    blockNumber: 101n,
    logs: status === "success" ? [deploymentLog()] : [],
    status,
    transactionHash: TRANSACTION,
  } as never;
}

function registryClient(overrides: Record<string, unknown> = {}) {
  return mockPublicClient({
    getBalance: async () => 1n,
    getCode: async ({ address }: { address: Address }) =>
      address === STYLUS_DEPLOYER_ADDRESS ? "0x6001" : "0x6002",
    readContract: async ({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        owner: SPECIFICATION.owner,
        permittedSender: SPECIFICATION.permittedSender,
        permittedReceiver: SPECIFICATION.permittedReceiver,
        maxHandoffs: BigInt(SPECIFICATION.maxHandoffs),
        expiry: BigInt(SPECIFICATION.expiry),
        handoffCount: 0n,
        programVersion: 1,
      };
      return values[functionName];
    },
    waitForTransactionReceipt: async () => receipt(),
    ...overrides,
  });
}

describe("Stylus deployment chain evidence", () => {
  it("extracts only the fixed deployer event and confirms exact configuration", async () => {
    expect(deploymentAddressFromReceipt(receipt())).toBe(CONTRACT);

    await expect(
      confirmStylusDeployment(
        registryClient(),
        TRANSACTION,
        CONTRACT,
        SPECIFICATION,
      ),
    ).resolves.toMatchObject({
      inspection: {
        activatedVersion: 1,
        configuration: {
          owner: SPECIFICATION.owner,
          maxHandoffs: SPECIFICATION.maxHandoffs,
        },
      },
      status: "confirmed",
    });
  });

  it("rejects a successful transaction with changed constructor state", async () => {
    const client = registryClient({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "maxHandoffs"
          ? 6n
          : functionName === "programVersion"
            ? 1
            : functionName === "handoffCount"
              ? 0n
              : SPECIFICATION[
                  functionName as
                    "owner" | "permittedSender" | "permittedReceiver"
                ],
    });

    await expect(
      confirmStylusDeployment(client, TRANSACTION, CONTRACT, SPECIFICATION),
    ).resolves.toEqual({
      status: "unknown",
      transactionHash: TRANSACTION,
      reason: "configuration_mismatch",
    });
  });

  it("prepares sender nonce and block only on funded Arbitrum Sepolia", async () => {
    await expect(
      prepareStylusDeployment(registryClient(), TEST_ACCOUNT),
    ).resolves.toEqual({ nonce: 7, sender: TEST_ACCOUNT, startBlock: 100n });
    await expect(
      prepareStylusDeployment(
        registryClient({ getBalance: async () => 0n }),
        TEST_ACCOUNT,
      ),
    ).rejects.toMatchObject({ code: "insufficient_relayer_balance" });
    await expect(
      isStylusDeploymentPreparationCurrent(registryClient(), {
        nonce: 7,
        sender: TEST_ACCOUNT,
        startBlock: 100n,
      }),
    ).resolves.toBe(true);
    await expect(
      isStylusDeploymentPreparationCurrent(
        registryClient({ getTransactionCount: async () => 8 }),
        { nonce: 7, sender: TEST_ACCOUNT, startBlock: 100n },
      ),
    ).resolves.toBe(false);
  });

  it("finds the exact sender and nonce without blind redeployment", async () => {
    const client = registryClient({
      getBlockNumber: async () => 102n,
      getLogs: async () => [deploymentLog()],
      getTransaction: async () => ({
        from: TEST_ACCOUNT,
        hash: TRANSACTION,
        nonce: 7,
      }),
      getTransactionReceipt: async () => receipt(),
    });

    await expect(
      reconcileStylusDeployment(client, {
        nonce: 7,
        requiredObservationBlock: 102n,
        sender: TEST_ACCOUNT,
        specification: SPECIFICATION,
        startBlock: 100n,
      }),
    ).resolves.toEqual({
      status: "present",
      contractAddress: CONTRACT,
      observedBlock: 102n,
      transactionHash: TRANSACTION,
    });
  });

  it("does not call a consumed nonce missing when its event is outside the bounded range", async () => {
    const client = registryClient({
      getBlockNumber: async () => 10_101n,
      getLogs: async () => [],
      getTransactionCount: async () => 8,
    });

    await expect(
      reconcileStylusDeployment(client, {
        nonce: 7,
        requiredObservationBlock: 102n,
        sender: TEST_ACCOUNT,
        specification: SPECIFICATION,
        startBlock: 100n,
      }),
    ).resolves.toEqual({
      status: "inconclusive",
      observedBlock: 10_101n,
      reason: "transaction_not_found",
    });
  });
});
