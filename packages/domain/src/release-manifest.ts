import { hashTypedData, type Hex } from "viem";
import { z } from "zod";

import { PRODUCT } from "./product.js";
import { taskRegistrySpecSchema } from "./release-specification.js";
import {
  assertCurrentUnixSeconds,
  fieldErrors,
  MAX_SUPPORTED_UNIX_SECONDS,
  type FieldValidationError,
  type ValidationResult,
} from "./validation.js";

const ZERO_BYTES_32 = `0x${"0".repeat(64)}`;
const UINT_256_MAX = (1n << 256n) - 1n;

const bytes32 = z
  .string({ error: "A 32-byte hash is required." })
  .regex(/^0x[0-9a-fA-F]{64}$/, "Use a 0x-prefixed 32-byte hexadecimal hash.")
  .refine((value) => value.toLowerCase() !== ZERO_BYTES_32, {
    message: "A zero hash is not valid evidence.",
  })
  .transform((value) => value.toLowerCase() as Hex);

const nonce = z
  .string({ error: "The release nonce must be a decimal string." })
  .regex(/^(0|[1-9][0-9]*)$/, "Use a canonical non-negative decimal nonce.")
  .refine((value) => BigInt(value) <= UINT_256_MAX, {
    message: "The release nonce exceeds the uint256 limit.",
  });

export const releaseManifestSchema = z
  .strictObject({
    version: z.literal(1, {
      error: "Only release manifest version 1 is supported.",
    }),
    releaseId: bytes32,
    specification: taskRegistrySpecSchema,
    sourceHash: bytes32,
    artifactHash: bytes32,
    testEvidenceHash: bytes32,
    toolchainHash: bytes32,
    chainId: z.literal(PRODUCT.networkChainId, {
      error: "SwarmShip v1 only releases to Arbitrum Sepolia.",
    }),
    nonce,
    approvalExpiry: z
      .number({ error: "The approval expiry must be a Unix timestamp." })
      .int("The approval expiry must be a whole Unix timestamp.")
      .positive("The approval expiry must be after Unix epoch.")
      .max(
        MAX_SUPPORTED_UNIX_SECONDS,
        "The approval expiry must be a readable calendar date.",
      ),
  })
  .refine(
    (manifest) => manifest.approvalExpiry <= manifest.specification.expiry,
    {
      path: ["approvalExpiry"],
      message:
        "Approval cannot remain valid after the contract permission expires.",
    },
  );

export type ReleaseManifestV1 = z.infer<typeof releaseManifestSchema>;

export const RELEASE_MANIFEST_DOMAIN = {
  name: PRODUCT.name,
  version: "1",
  chainId: PRODUCT.networkChainId,
} as const;

export const RELEASE_MANIFEST_TYPES = {
  TaskRegistrySpecV1: [
    { name: "owner", type: "address" },
    { name: "permittedSender", type: "address" },
    { name: "permittedReceiver", type: "address" },
    { name: "maxHandoffs", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
  ReleaseManifestV1: [
    { name: "version", type: "uint16" },
    { name: "releaseId", type: "bytes32" },
    { name: "specification", type: "TaskRegistrySpecV1" },
    { name: "sourceHash", type: "bytes32" },
    { name: "artifactHash", type: "bytes32" },
    { name: "testEvidenceHash", type: "bytes32" },
    { name: "toolchainHash", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "approvalExpiry", type: "uint64" },
  ],
} as const;

export function validateReleaseManifest(
  input: unknown,
  nowUnixSeconds: number,
): ValidationResult<ReleaseManifestV1> {
  assertCurrentUnixSeconds(nowUnixSeconds);
  const parsed = releaseManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errors: fieldErrors(parsed.error) };
  }

  const errors: FieldValidationError[] = [];
  if (parsed.data.specification.expiry <= nowUnixSeconds) {
    errors.push({
      field: "specification.expiry",
      message: "The contract permission must expire in the future.",
    });
  }
  if (parsed.data.approvalExpiry <= nowUnixSeconds) {
    errors.push({
      field: "approvalExpiry",
      message: "The approval must expire in the future.",
    });
  }

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: parsed.data };
}

export function toReleaseManifestTypedData(input: ReleaseManifestV1) {
  const manifest = releaseManifestSchema.parse(input);

  return {
    domain: RELEASE_MANIFEST_DOMAIN,
    types: RELEASE_MANIFEST_TYPES,
    primaryType: "ReleaseManifestV1",
    message: {
      version: manifest.version,
      releaseId: manifest.releaseId,
      specification: {
        owner: manifest.specification.owner,
        permittedSender: manifest.specification.permittedSender,
        permittedReceiver: manifest.specification.permittedReceiver,
        maxHandoffs: BigInt(manifest.specification.maxHandoffs),
        expiry: BigInt(manifest.specification.expiry),
      },
      sourceHash: manifest.sourceHash,
      artifactHash: manifest.artifactHash,
      testEvidenceHash: manifest.testEvidenceHash,
      toolchainHash: manifest.toolchainHash,
      chainId: BigInt(manifest.chainId),
      nonce: BigInt(manifest.nonce),
      approvalExpiry: BigInt(manifest.approvalExpiry),
    },
  } as const;
}

export function hashReleaseManifest(input: ReleaseManifestV1): Hex {
  return hashTypedData(toReleaseManifestTypedData(input));
}
