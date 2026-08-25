import { encodeEventTopics, encodeAbiParameters } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  HERO_PROOF_ANCHOR_ABI,
  HERO_PROOF_ANCHOR_ADDRESS,
} from "./hero-abi.js";
import {
  broadcastHeroAnchor,
  confirmHeroAnchor,
  prepareHeroAnchor,
} from "./hero-writer.js";
import {
  mockPublicClient,
  mockWalletClient,
  TEST_ACCOUNT,
  TEST_HASH,
  TEST_ROOT,
} from "./test-clients.js";

function proofLog() {
  return {
    address: HERO_PROOF_ANCHOR_ADDRESS,
    data: encodeAbiParameters([{ type: "uint64" }], [1_700_000_000n]),
    topics: encodeEventTopics({
      abi: HERO_PROOF_ANCHOR_ABI,
      eventName: "ProofAnchored",
      args: { proofRoot: TEST_ROOT, submitter: TEST_ACCOUNT },
    }),
    blockHash: TEST_HASH,
    blockNumber: 101n,
    logIndex: 2,
    transactionHash: TEST_HASH,
    transactionIndex: 0,
    removed: false,
  };
}

describe("HERŌ proof writer", () => {
  it("returns an existing root without simulation or a write", async () => {
    const simulateContract = vi.fn();
    const writeContract = vi.fn();
    const client = mockPublicClient({
      simulateContract,
      readContract: async () => [true, 10n, TEST_ACCOUNT],
    });

    const result = await prepareHeroAnchor(
      client,
      mockWalletClient({ writeContract }),
      TEST_ROOT,
    );

    expect(result.kind).toBe("already_anchored");
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("records nonce and start block only after a successful simulation", async () => {
    const simulateContract = vi.fn(async () => ({ request: {} }));
    const result = await prepareHeroAnchor(
      mockPublicClient({ simulateContract }),
      mockWalletClient(),
      TEST_ROOT,
    );

    expect(result).toEqual({
      kind: "ready",
      proofRoot: TEST_ROOT,
      sender: TEST_ACCOUNT,
      nonce: 7,
      startBlock: 100n,
    });
    expect(simulateContract).toHaveBeenCalledOnce();
  });

  it("simulates the persisted nonce again before broadcasting", async () => {
    const calls: string[] = [];
    const client = mockPublicClient({
      simulateContract: async () => {
        calls.push("simulate");
        return { request: { account: TEST_ACCOUNT } };
      },
    });
    const wallet = mockWalletClient({
      writeContract: async () => {
        calls.push("write");
        return TEST_HASH;
      },
    });

    const result = await broadcastHeroAnchor(client, wallet, {
      kind: "ready",
      proofRoot: TEST_ROOT,
      sender: TEST_ACCOUNT,
      nonce: 7,
      startBlock: 100n,
    });

    expect(result).toEqual({ kind: "submitted", transactionHash: TEST_HASH });
    expect(calls).toEqual(["simulate", "write"]);
  });

  it("does not write when the root appears after preparation", async () => {
    const writeContract = vi.fn();
    const result = await broadcastHeroAnchor(
      mockPublicClient({
        readContract: async () => [true, 10n, TEST_ACCOUNT],
      }),
      mockWalletClient({ writeContract }),
      {
        kind: "ready",
        proofRoot: TEST_ROOT,
        sender: TEST_ACCOUNT,
        nonce: 7,
        startBlock: 100n,
      },
    );

    expect(result.kind).toBe("already_anchored");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("confirms only a successful receipt with matching event and proof", async () => {
    const client = mockPublicClient({
      waitForTransactionReceipt: async () => ({
        blockNumber: 101n,
        logs: [proofLog()],
        status: "success",
      }),
      readContract: async () => [true, 1_700_000_000n, TEST_ACCOUNT],
    });

    await expect(
      confirmHeroAnchor(client, TEST_ROOT, TEST_HASH),
    ).resolves.toMatchObject({
      status: "confirmed",
      transactionHash: TEST_HASH,
      blockNumber: 101n,
      logIndex: 2,
      proof: { anchored: true, submitter: TEST_ACCOUNT },
    });
  });

  it("separates reverted, unavailable, and incomplete receipts", async () => {
    const reverted = mockPublicClient({
      waitForTransactionReceipt: async () => ({
        blockNumber: 101n,
        logs: [],
        status: "reverted",
      }),
    });
    await expect(
      confirmHeroAnchor(reverted, TEST_ROOT, TEST_HASH),
    ).resolves.toEqual({
      status: "reverted",
      transactionHash: TEST_HASH,
      blockNumber: 101n,
    });

    const unavailable = mockPublicClient({
      waitForTransactionReceipt: async () =>
        Promise.reject(new Error("timeout")),
    });
    await expect(
      confirmHeroAnchor(unavailable, TEST_ROOT, TEST_HASH),
    ).resolves.toMatchObject({
      status: "unknown",
      reason: "receipt_unavailable",
    });

    await expect(
      confirmHeroAnchor(mockPublicClient(), TEST_ROOT, TEST_HASH),
    ).resolves.toMatchObject({
      status: "unknown",
      reason: "proof_event_missing",
    });
  });

  it("rejects receipt metadata that disagrees with the stored proof", async () => {
    const client = mockPublicClient({
      waitForTransactionReceipt: async () => ({
        blockNumber: 101n,
        logs: [proofLog()],
        status: "success",
      }),
      readContract: async () => [true, 1_700_000_001n, TEST_ACCOUNT],
    });

    await expect(
      confirmHeroAnchor(client, TEST_ROOT, TEST_HASH),
    ).resolves.toMatchObject({
      status: "unknown",
      reason: "proof_mismatch",
    });
  });
});
