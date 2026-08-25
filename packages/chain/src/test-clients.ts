import type { Address, Hash, Hex } from "viem";

import { HERO_PROOF_ANCHOR_ADDRESS } from "./hero-abi.js";
import type { HeroPublicClient, HeroWalletClient } from "./clients.js";

export const TEST_ACCOUNT =
  "0x1111111111111111111111111111111111111111" as Address;
export const TEST_HASH = `0x${"55".repeat(32)}` as Hash;
export const TEST_ROOT = `0x${"66".repeat(32)}` as const;

export function mockPublicClient(
  overrides: Record<string, unknown> = {},
): HeroPublicClient {
  return {
    getChainId: async () => 421_614,
    getCode: async () => "0x6001" as Hex,
    readContract: async () => [
      false,
      0n,
      "0x0000000000000000000000000000000000000000",
    ],
    getBlockNumber: async () => 100n,
    getTransactionCount: async () => 7,
    simulateContract: async () => ({
      request: {
        account: TEST_ACCOUNT,
        address: HERO_PROOF_ANCHOR_ADDRESS,
      },
    }),
    waitForTransactionReceipt: async () => ({
      blockNumber: 101n,
      logs: [],
      status: "success",
    }),
    getContractEvents: async () => [],
    ...overrides,
  } as unknown as HeroPublicClient;
}

export function mockWalletClient(
  overrides: Record<string, unknown> = {},
): HeroWalletClient {
  return {
    account: { address: TEST_ACCOUNT },
    writeContract: async () => TEST_HASH,
    ...overrides,
  } as unknown as HeroWalletClient;
}
