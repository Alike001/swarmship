import { describe, expect, it } from "vitest";

import {
  createReleaseReceipt,
  hashReleaseReceipt,
  releaseReceiptSchema,
  toReleaseReceiptTypedData,
  type ReleaseReceiptV1,
} from "./release-receipt.js";

const receipt: ReleaseReceiptV1 = {
  version: 1,
  releaseId:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  manifestRoot:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  artifactHash:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  deploymentTransaction:
    "0x4444444444444444444444444444444444444444444444444444444444444444",
  deployedAddress: "0x1111111111111111111111111111111111111111",
  chainId: 421614,
  deploymentBlockNumber: "210000001",
  deploymentSender: "0x2222222222222222222222222222222222222222",
  deploymentNonce: "7",
  observedCodeHash:
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  observedSpecification: {
    contractFamily: "agent-task-registry-v1",
    owner: "0x3333333333333333333333333333333333333333",
    permittedSender: "0x4444444444444444444444444444444444444444",
    permittedReceiver: "0x5555555555555555555555555555555555555555",
    maxHandoffs: 5,
    expiry: 1_800_000_000,
  },
  activatedVersion: 1,
  handoffCount: "0",
  sourceVerification: "passed",
};

describe("ReleaseReceiptV1", () => {
  it("normalizes and hashes one canonical known vector", () => {
    const created = createReleaseReceipt(receipt);
    expect(created).toEqual(receipt);
    expect(hashReleaseReceipt(created)).toBe(
      "0xdea146234d2a2b75b2bffd5c604ed6ff7576d752d2aafacd3cd99bc365e82305",
    );
  });

  it("produces JSON-safe typed data only at the public boundary", () => {
    const typed = toReleaseReceiptTypedData(receipt);
    expect(typed.primaryType).toBe("ReleaseReceiptV1");
    expect(typed.message.deploymentNonce).toBe(7n);
    expect(typed.message.sourceVerified).toBe(true);
  });

  it.each([
    ["zero code hash", { observedCodeHash: `0x${"0".repeat(64)}` }],
    ["wrong chain", { chainId: 1 }],
    ["non-canonical nonce", { deploymentNonce: "07" }],
    ["unverified source", { sourceVerification: "failed" }],
    ["zero activation", { activatedVersion: 0 }],
  ])("rejects %s", (_label, override) => {
    expect(
      releaseReceiptSchema.safeParse({ ...receipt, ...override }).success,
    ).toBe(false);
  });

  it("rejects unknown fields and invalid observed specifications", () => {
    expect(
      releaseReceiptSchema.safeParse({ ...receipt, invented: true }).success,
    ).toBe(false);
    expect(
      releaseReceiptSchema.safeParse({
        ...receipt,
        observedSpecification: {
          ...receipt.observedSpecification,
          permittedReceiver: receipt.observedSpecification.permittedSender,
        },
      }).success,
    ).toBe(false);
  });
});
