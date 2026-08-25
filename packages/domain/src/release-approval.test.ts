import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  createReleaseManifest,
  summarizeReleaseManifest,
  verifyManifestApproval,
} from "./release-approval.js";
import {
  hashReleaseManifest,
  toReleaseManifestTypedData,
} from "./release-manifest.js";

const NOW = 1_800_000_000;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;

function hash(character: string) {
  return `0x${character.repeat(64)}` as const;
}

function manifest(owner: `0x${string}`) {
  return createReleaseManifest({
    approvalExpiry: NOW + 900,
    artifactHash: hash("3"),
    publicId: "release_1234567890abcdef",
    releaseVersion: 3,
    sourceHash: hash("2"),
    specification: {
      contractFamily: "agent-task-registry-v1",
      owner,
      permittedSender: SENDER,
      permittedReceiver: RECEIVER,
      maxHandoffs: 5,
      expiry: NOW + 3_600,
    },
    testEvidenceHash: hash("4"),
    toolchainHash: hash("5"),
  });
}

describe("release approval", () => {
  it("derives a stable manifest from the release identity and evidence", () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const first = manifest(owner);
    const second = manifest(owner);

    expect(first).toEqual(second);
    expect(first.nonce).toBe("3");
    expect(first.releaseId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashReleaseManifest(first)).toBe(hashReleaseManifest(second));
  });

  it("accepts the exact owner signature", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const releaseManifest = manifest(owner.address);
    const signature = await owner.signTypedData(
      toReleaseManifestTypedData(releaseManifest),
    );

    const result = await verifyManifestApproval(
      releaseManifest,
      signature,
      NOW,
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        digest: hashReleaseManifest(releaseManifest),
        signer: owner.address,
      },
    });
  });

  it("rejects a valid signature from a different wallet", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const releaseManifest = manifest(owner.address);
    const signature = await other.signTypedData(
      toReleaseManifestTypedData(releaseManifest),
    );

    await expect(
      verifyManifestApproval(releaseManifest, signature, NOW),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "wrong_signer" },
    });
  });

  it("rejects malformed and expired approvals safely", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const releaseManifest = manifest(owner.address);

    await expect(
      verifyManifestApproval(releaseManifest, "0x1234", NOW),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "invalid_signature" },
    });
    await expect(
      verifyManifestApproval(
        releaseManifest,
        `0x${"1".repeat(130)}`,
        NOW + 901,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "invalid_manifest" },
    });
  });

  it("summarizes the exact behavior and evidence in plain language", () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;

    expect(summarizeReleaseManifest(manifest(owner))).toMatchObject({
      title: "Approve this exact contract release",
      network: "Arbitrum Sepolia",
    });
  });
});
