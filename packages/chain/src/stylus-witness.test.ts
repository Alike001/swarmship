import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type TransactionReceipt,
} from "viem";

import { STYLUS_DEPLOYER_ABI, STYLUS_DEPLOYER_ADDRESS } from "./stylus-abi.js";
import { observeStylusRelease } from "./stylus-witness.js";
import type { HeroPublicClient } from "./clients.js";

const TX = `0x${"1".repeat(64)}` as const;
const CONTRACT = getAddress("0x1111111111111111111111111111111111111111");
const SENDER = getAddress("0x2222222222222222222222222222222222222222");
const RECEIVER = getAddress("0x3333333333333333333333333333333333333333");
const OWNER = getAddress("0x4444444444444444444444444444444444444444");
const SPEC = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: OWNER,
  permittedSender: SENDER,
  permittedReceiver: RECEIVER,
  maxHandoffs: 5,
  expiry: 1_900_000_000,
};

function deploymentReceipt(status: "success" | "reverted" = "success") {
  return {
    status,
    blockNumber: 99n,
    logs: [
      {
        address: STYLUS_DEPLOYER_ADDRESS,
        topics: encodeEventTopics({
          abi: STYLUS_DEPLOYER_ABI,
          eventName: "ContractDeployed",
        }),
        data: encodeAbiParameters([{ type: "address" }], [CONTRACT]),
        blockHash: `0x${"2".repeat(64)}`,
        blockNumber: 99n,
        logIndex: 0,
        transactionHash: TX,
        transactionIndex: 0,
        removed: false,
      },
    ],
  } as unknown as TransactionReceipt;
}

function client(overrides: Record<string, unknown> = {}): HeroPublicClient {
  const reads: Record<string, unknown> = {
    owner: OWNER,
    permittedSender: SENDER,
    permittedReceiver: RECEIVER,
    maxHandoffs: 5n,
    expiry: 1_900_000_000n,
    handoffCount: 0n,
    programVersion: 1n,
  };
  return {
    getChainId: async () => 421614,
    getCode: async () => "0x6001600055",
    getTransaction: async () => ({ from: SENDER, nonce: 7 }),
    readContract: async ({ functionName }: { functionName: string }) =>
      reads[functionName],
    waitForTransactionReceipt: async () => deploymentReceipt(),
    ...overrides,
  } as unknown as HeroPublicClient;
}

function changedMaxHandoffsClient(): HeroPublicClient {
  const base = client() as unknown as {
    readContract(input: { functionName: string }): Promise<unknown>;
  };
  return client({
    readContract: async (input: { functionName: string }) =>
      input.functionName === "maxHandoffs" ? 6n : base.readContract(input),
  });
}

describe("independent Stylus witness", () => {
  it("returns canonical chain observations from the witness client", async () => {
    await expect(
      observeStylusRelease(client(), TX, CONTRACT, SPEC),
    ).resolves.toMatchObject({
      status: "confirmed",
      blockNumber: 99n,
      chainId: 421614,
      nonce: 7,
      sender: SENDER,
      transactionHash: TX,
    });
  });

  it("rejects a wrong chain and deterministic configuration mismatch", async () => {
    await expect(
      observeStylusRelease(
        client({ getChainId: async () => 1 }),
        TX,
        CONTRACT,
        SPEC,
      ),
    ).resolves.toEqual({ status: "mismatch", reason: "wrong_chain" });
    await expect(
      observeStylusRelease(changedMaxHandoffsClient(), TX, CONTRACT, SPEC),
    ).resolves.toEqual({
      status: "mismatch",
      reason: "configuration_mismatch",
    });
  });

  it("keeps unavailable chain data unknown", async () => {
    await expect(
      observeStylusRelease(
        client({
          getTransaction: async () => Promise.reject(new Error("offline")),
        }),
        TX,
        CONTRACT,
        SPEC,
      ),
    ).resolves.toEqual({
      status: "unknown",
      reason: "transaction_unavailable",
    });
  });
});
