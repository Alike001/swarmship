import { getAddress, hashTypedData, type Hex } from "viem";
import { z } from "zod";

import { nonZeroBytes32Schema } from "./evm-primitives.js";
import { PRODUCT } from "./product.js";
import { taskRegistrySpecSchema } from "./release-specification.js";

const UINT_256_MAX = (1n << 256n) - 1n;

const addressSchema = z
  .string({ error: "A deployed contract address is required." })
  .regex(/^0x[0-9a-fA-F]{40}$/, "Use a 20-byte EVM address.")
  .transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use a valid EVM address checksum.",
      });
      return z.NEVER;
    }
  });

const decimal = (label: string) =>
  z
    .string({ error: `${label} must be a decimal string.` })
    .regex(/^(0|[1-9][0-9]*)$/, `Use a canonical ${label.toLowerCase()}.`)
    .refine((value) => BigInt(value) <= UINT_256_MAX, {
      message: `${label} exceeds the uint256 limit.`,
    });

export const releaseReceiptSchema = z.strictObject({
  version: z.literal(1, {
    error: "Only release receipt version 1 is supported.",
  }),
  releaseId: nonZeroBytes32Schema,
  manifestRoot: nonZeroBytes32Schema,
  artifactHash: nonZeroBytes32Schema,
  deploymentTransaction: nonZeroBytes32Schema,
  deployedAddress: addressSchema,
  chainId: z.literal(PRODUCT.networkChainId, {
    error: "SwarmShip v1 only witnesses Arbitrum Sepolia.",
  }),
  deploymentBlockNumber: decimal("Deployment block number"),
  deploymentSender: addressSchema,
  deploymentNonce: decimal("Deployment nonce"),
  observedCodeHash: nonZeroBytes32Schema,
  observedSpecification: taskRegistrySpecSchema,
  activatedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  handoffCount: decimal("Handoff count"),
  sourceVerification: z.literal("passed"),
});

export type ReleaseReceiptV1 = z.infer<typeof releaseReceiptSchema>;

export const RELEASE_RECEIPT_DOMAIN = {
  name: `${PRODUCT.name} Receipt`,
  version: "1",
  chainId: PRODUCT.networkChainId,
} as const;

export const RELEASE_RECEIPT_TYPES = {
  TaskRegistrySpecV1: [
    { name: "contractFamily", type: "string" },
    { name: "owner", type: "address" },
    { name: "permittedSender", type: "address" },
    { name: "permittedReceiver", type: "address" },
    { name: "maxHandoffs", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
  ReleaseReceiptV1: [
    { name: "version", type: "uint16" },
    { name: "releaseId", type: "bytes32" },
    { name: "manifestRoot", type: "bytes32" },
    { name: "artifactHash", type: "bytes32" },
    { name: "deploymentTransaction", type: "bytes32" },
    { name: "deployedAddress", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "deploymentBlockNumber", type: "uint256" },
    { name: "deploymentSender", type: "address" },
    { name: "deploymentNonce", type: "uint256" },
    { name: "observedCodeHash", type: "bytes32" },
    { name: "observedSpecification", type: "TaskRegistrySpecV1" },
    { name: "activatedVersion", type: "uint256" },
    { name: "handoffCount", type: "uint256" },
    { name: "sourceVerified", type: "bool" },
  ],
} as const;

export function createReleaseReceipt(
  input: ReleaseReceiptV1,
): ReleaseReceiptV1 {
  return releaseReceiptSchema.parse(input);
}

export function toReleaseReceiptTypedData(input: ReleaseReceiptV1) {
  const receipt = releaseReceiptSchema.parse(input);
  return {
    domain: RELEASE_RECEIPT_DOMAIN,
    types: RELEASE_RECEIPT_TYPES,
    primaryType: "ReleaseReceiptV1",
    message: {
      version: receipt.version,
      releaseId: receipt.releaseId,
      manifestRoot: receipt.manifestRoot,
      artifactHash: receipt.artifactHash,
      deploymentTransaction: receipt.deploymentTransaction,
      deployedAddress: receipt.deployedAddress,
      chainId: BigInt(receipt.chainId),
      deploymentBlockNumber: BigInt(receipt.deploymentBlockNumber),
      deploymentSender: receipt.deploymentSender,
      deploymentNonce: BigInt(receipt.deploymentNonce),
      observedCodeHash: receipt.observedCodeHash,
      observedSpecification: {
        contractFamily: receipt.observedSpecification.contractFamily,
        owner: receipt.observedSpecification.owner,
        permittedSender: receipt.observedSpecification.permittedSender,
        permittedReceiver: receipt.observedSpecification.permittedReceiver,
        maxHandoffs: BigInt(receipt.observedSpecification.maxHandoffs),
        expiry: BigInt(receipt.observedSpecification.expiry),
      },
      activatedVersion: BigInt(receipt.activatedVersion),
      handoffCount: BigInt(receipt.handoffCount),
      sourceVerified: receipt.sourceVerification === "passed",
    },
  } as const;
}

export function hashReleaseReceipt(input: ReleaseReceiptV1): Hex {
  return hashTypedData(toReleaseReceiptTypedData(input));
}
