import { describe, expect, it } from "vitest";

import { PRODUCT } from "./product.js";
import {
  hashReleaseManifest,
  toReleaseManifestTypedData,
  validateReleaseManifest,
  type ReleaseManifestV1,
} from "./release-manifest.js";
import { TASK_REGISTRY_CONTRACT_FAMILY } from "./release-specification.js";

const NOW = 1_800_000_000;
const OWNER = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const SENDER = "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826";
const RECEIVER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

function hash(character: string) {
  return `0x${character.repeat(64)}` as const;
}

function validManifest(): ReleaseManifestV1 {
  return {
    version: 1,
    releaseId: hash("1"),
    specification: {
      contractFamily: TASK_REGISTRY_CONTRACT_FAMILY,
      owner: OWNER,
      permittedSender: SENDER,
      permittedReceiver: RECEIVER,
      maxHandoffs: 5,
      expiry: NOW + 3_600,
    },
    sourceHash: hash("2"),
    artifactHash: hash("3"),
    testEvidenceHash: hash("4"),
    toolchainHash: hash("5"),
    chainId: PRODUCT.networkChainId,
    nonce: "7",
    approvalExpiry: NOW + 900,
  };
}

describe("release manifest", () => {
  it("builds fixed EIP-712 data for Arbitrum Sepolia", () => {
    const typedData = toReleaseManifestTypedData(validManifest());

    expect(typedData.domain).toEqual({
      name: "SwarmShip",
      version: "1",
      chainId: 421_614,
    });
    expect(typedData.primaryType).toBe("ReleaseManifestV1");
    expect(typedData.message.nonce).toBe(7n);
    expect(typedData.message.specification.maxHandoffs).toBe(5n);
  });

  it("produces the same digest for repeated canonical input", () => {
    const first = hashReleaseManifest(validManifest());
    const second = hashReleaseManifest(validManifest());

    expect(first).toBe(second);
    expect(first).toBe(
      "0x4a243bfb326ebe917264f3fbb834d0c81defaecf25cd04de5f56cf39f78a3a7b",
    );
  });

  it("changes the digest when any security-relevant value changes", () => {
    const original = validManifest();
    const mutations: ReleaseManifestV1[] = [
      { ...original, releaseId: hash("a") },
      { ...original, sourceHash: hash("b") },
      { ...original, artifactHash: hash("c") },
      { ...original, testEvidenceHash: hash("d") },
      { ...original, toolchainHash: hash("e") },
      { ...original, nonce: "8" },
      { ...original, approvalExpiry: original.approvalExpiry + 1 },
      {
        ...original,
        specification: {
          ...original.specification,
          owner: `0x${"1".repeat(40)}`,
        },
      },
      {
        ...original,
        specification: { ...original.specification, permittedSender: OWNER },
      },
      {
        ...original,
        specification: { ...original.specification, permittedReceiver: OWNER },
      },
      {
        ...original,
        specification: {
          ...original.specification,
          maxHandoffs: original.specification.maxHandoffs + 1,
        },
      },
      {
        ...original,
        specification: {
          ...original.specification,
          expiry: original.specification.expiry + 1,
        },
      },
    ];
    const originalDigest = hashReleaseManifest(original);
    const changedDigests = mutations.map(hashReleaseManifest);

    expect(changedDigests.every((digest) => digest !== originalDigest)).toBe(
      true,
    );
    expect(new Set(changedDigests).size).toBe(mutations.length);
  });

  it.each([
    ["unsupported version", { version: 2 }, "version"],
    ["unsupported chain", { chainId: 1 }, "chainId"],
    ["malformed artifact hash", { artifactHash: "0x1234" }, "artifactHash"],
    ["zero evidence hash", { testEvidenceHash: hash("0") }, "testEvidenceHash"],
    ["non-canonical nonce", { nonce: "01" }, "nonce"],
    ["expired approval", { approvalExpiry: NOW }, "approvalExpiry"],
  ])("rejects %s with a field-level error", (_, change, field) => {
    const result = validateReleaseManifest(
      { ...validManifest(), ...change },
      NOW,
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors.map((error) => error.field)).toContain(field);
  });

  it("does not allow approval beyond the contract permission", () => {
    const manifest = validManifest();
    const result = validateReleaseManifest(
      { ...manifest, approvalExpiry: manifest.specification.expiry + 1 },
      NOW,
    );

    expect(result).toMatchObject({
      success: false,
      errors: [{ field: "approvalExpiry" }],
    });
  });

  it("reports both expired approval and expired contract authority", () => {
    const result = validateReleaseManifest(validManifest(), NOW + 3_600);

    expect(result).toMatchObject({
      success: false,
      errors: [{ field: "specification.expiry" }, { field: "approvalExpiry" }],
    });
  });

  it("can rehash historical evidence after its authority has expired", () => {
    const manifest = validManifest();
    const originalDigest = hashReleaseManifest(manifest);

    expect(validateReleaseManifest(manifest, NOW + 3_600).success).toBe(false);
    expect(hashReleaseManifest(manifest)).toBe(originalDigest);
  });

  it("rejects an invalid clock value instead of bypassing approval checks", () => {
    expect(() => validateReleaseManifest(validManifest(), Number.NaN)).toThrow(
      "Current time must be a supported whole Unix timestamp.",
    );
  });
});
