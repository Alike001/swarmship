import { describe, expect, it } from "vitest";

import { reconcileHeroAnchor } from "./hero-reconciliation.js";
import { mockPublicClient, TEST_ACCOUNT, TEST_ROOT } from "./test-clients.js";

describe("HERŌ anchor reconciliation", () => {
  it("returns present as soon as the independent read proves the root", async () => {
    const client = mockPublicClient({
      getBlockNumber: async () => 105n,
      readContract: async () => [true, 1_700_000_000n, TEST_ACCOUNT],
    });

    await expect(
      reconcileHeroAnchor(client, {
        proofRoot: TEST_ROOT,
        startBlock: 100n,
        requiredObservationBlock: 112n,
      }),
    ).resolves.toMatchObject({ status: "present", observedBlock: 105n });
  });

  it("remains inconclusive until the observation block is reached", async () => {
    const result = await reconcileHeroAnchor(mockPublicClient(), {
      proofRoot: TEST_ROOT,
      startBlock: 100n,
      requiredObservationBlock: 112n,
    });

    expect(result).toEqual({
      status: "inconclusive",
      observedBlock: 100n,
      reason: "observation_block_not_reached",
    });
  });

  it("returns missing only after a bounded empty scan", async () => {
    const result = await reconcileHeroAnchor(
      mockPublicClient({ getBlockNumber: async () => 120n }),
      {
        proofRoot: TEST_ROOT,
        startBlock: 100n,
        requiredObservationBlock: 112n,
      },
    );

    expect(result).toEqual({ status: "missing", observedBlock: 120n });
  });

  it("reports inconsistent evidence when an event exists but verify is false", async () => {
    const client = mockPublicClient({
      getBlockNumber: async () => 120n,
      getContractEvents: async () => [{ eventName: "ProofAnchored" }],
    });

    await expect(
      reconcileHeroAnchor(client, {
        proofRoot: TEST_ROOT,
        startBlock: 100n,
        requiredObservationBlock: 112n,
      }),
    ).resolves.toEqual({
      status: "inconclusive",
      observedBlock: 120n,
      reason: "inconsistent_evidence",
    });
  });

  it("reports RPC outages and rejects unsafe scan ranges", async () => {
    const failed = mockPublicClient({
      readContract: async () => Promise.reject(new Error("offline")),
    });
    await expect(
      reconcileHeroAnchor(failed, {
        proofRoot: TEST_ROOT,
        startBlock: 100n,
        requiredObservationBlock: 112n,
      }),
    ).resolves.toEqual({
      status: "inconclusive",
      observedBlock: null,
      reason: "rpc_unavailable",
    });

    await expect(
      reconcileHeroAnchor(mockPublicClient(), {
        proofRoot: TEST_ROOT,
        startBlock: 100n,
        requiredObservationBlock: 10_101n,
      }),
    ).rejects.toMatchObject({ code: "invalid_reconciliation_range" });
  });
});
