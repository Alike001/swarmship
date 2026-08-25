import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";

import { HERO_PROOF_ANCHOR_ADDRESS } from "./hero-abi.js";
import {
  inspectHeroDeployment,
  parseProofRoot,
  verifyHeroProof,
} from "./hero-reader.js";
import { mockPublicClient, TEST_ACCOUNT, TEST_ROOT } from "./test-clients.js";

describe("HERŌ proof reader", () => {
  it("accepts a non-zero lowercase bytes32 root", () => {
    expect(parseProofRoot(TEST_ROOT)).toBe(TEST_ROOT);
    expect(() => parseProofRoot(`0x${"00".repeat(32)}`)).toThrow(
      "non-zero lowercase bytes32",
    );
    expect(() => parseProofRoot(`0x${"AA".repeat(32)}`)).toThrow(
      "non-zero lowercase bytes32",
    );
  });

  it("rejects a client connected to the wrong chain", async () => {
    const client = mockPublicClient({ getChainId: async () => 1 });
    await expect(inspectHeroDeployment(client)).rejects.toMatchObject({
      code: "wrong_chain",
    });
  });

  it("rejects an address with no deployed bytecode", async () => {
    const client = mockPublicClient({ getCode: async () => "0x" });
    await expect(inspectHeroDeployment(client)).rejects.toMatchObject({
      code: "anchor_not_deployed",
    });
  });

  it("returns the configured deployment when code exists", async () => {
    await expect(
      inspectHeroDeployment(mockPublicClient()),
    ).resolves.toMatchObject({
      address: HERO_PROOF_ANCHOR_ADDRESS,
      chainId: 421_614,
      bytecode: "0x6001",
    });
  });

  it("decodes the sponsor verify tuple without inventing metadata", async () => {
    const anchored = mockPublicClient({
      readContract: async () => [true, 1_700_000_000n, TEST_ACCOUNT],
    });
    await expect(verifyHeroProof(anchored, TEST_ROOT)).resolves.toEqual({
      anchored: true,
      proofRoot: TEST_ROOT,
      timestamp: 1_700_000_000n,
      submitter: TEST_ACCOUNT,
    });

    await expect(
      verifyHeroProof(mockPublicClient(), TEST_ROOT),
    ).resolves.toEqual({
      anchored: false,
      proofRoot: TEST_ROOT,
      timestamp: 0n,
      submitter: zeroAddress,
    });
  });
});
