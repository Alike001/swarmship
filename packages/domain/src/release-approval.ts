import {
  getAddress,
  isAddress,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

import { nonZeroBytes32Schema } from "./evm-primitives.js";
import {
  hashReleaseManifest,
  releaseManifestSchema,
  toReleaseManifestTypedData,
  validateReleaseManifest,
  type ReleaseManifestV1,
} from "./release-manifest.js";
import { PRODUCT } from "./product.js";
import {
  summarizeTaskRegistrySpec,
  taskRegistrySpecSchema,
} from "./release-specification.js";
import { MAX_SUPPORTED_UNIX_SECONDS } from "./validation.js";

const signatureSchema = z
  .string({ error: "A wallet signature is required." })
  .regex(/^0x[0-9a-fA-F]{130}$/, "Use a 65-byte EVM signature.")
  .transform((signature) => signature as Hex);

const signerSchema = z
  .string({ error: "The approving wallet is required." })
  .refine((value) => isAddress(value, { strict: true }), {
    message: "Use a valid checksummed EVM address.",
  })
  .transform((value) => getAddress(value));

export const manifestApprovalSchema = z.strictObject({
  approvedAt: z.number().int().positive().max(MAX_SUPPORTED_UNIX_SECONDS),
  digest: nonZeroBytes32Schema,
  manifest: releaseManifestSchema,
  signature: signatureSchema,
  signer: signerSchema,
});

export type ManifestApprovalV1 = z.infer<typeof manifestApprovalSchema>;

export type CreateReleaseManifestInput = {
  approvalExpiry: number;
  artifactHash: Hex;
  publicId: string;
  releaseVersion: number;
  sourceHash: Hex;
  specification: z.input<typeof taskRegistrySpecSchema>;
  testEvidenceHash: Hex;
  toolchainHash: Hex;
};

export type ManifestApprovalResult =
  | { success: true; data: ManifestApprovalV1 }
  | {
      success: false;
      error: {
        code: "invalid_manifest" | "invalid_signature" | "wrong_signer";
        message: string;
      };
    };

export function createReleaseManifest(
  input: CreateReleaseManifestInput,
): ReleaseManifestV1 {
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 0) {
    throw new Error("Release version must be a non-negative safe integer.");
  }
  const publicId = z.string().min(8).max(80).parse(input.publicId);

  return releaseManifestSchema.parse({
    version: 1,
    releaseId: keccak256(toBytes(publicId)),
    specification: input.specification,
    sourceHash: input.sourceHash,
    artifactHash: input.artifactHash,
    testEvidenceHash: input.testEvidenceHash,
    toolchainHash: input.toolchainHash,
    chainId: PRODUCT.networkChainId,
    nonce: String(input.releaseVersion),
    approvalExpiry: input.approvalExpiry,
  });
}

export function summarizeReleaseManifest(manifest: ReleaseManifestV1) {
  const specification = summarizeTaskRegistrySpec(manifest.specification);
  return {
    title: "Approve this exact contract release",
    behavior: specification.permission,
    ownership: specification.ownership,
    limit: specification.limit,
    contractExpiry: specification.expiry,
    network: "Arbitrum Sepolia",
    artifact: `Artifact ${manifest.artifactHash} is the only build this approval permits.`,
    approvalExpiry: `This approval expires at ${new Date(manifest.approvalExpiry * 1_000).toISOString()}.`,
  };
}

export async function verifyManifestApproval(
  manifest: ReleaseManifestV1,
  signatureInput: unknown,
  nowUnixSeconds: number,
): Promise<ManifestApprovalResult> {
  const validated = validateReleaseManifest(manifest, nowUnixSeconds);
  if (!validated.success) {
    return {
      success: false,
      error: {
        code: "invalid_manifest",
        message: "This release approval is incomplete or has expired.",
      },
    };
  }
  const signature = signatureSchema.safeParse(signatureInput);
  if (!signature.success) {
    return {
      success: false,
      error: {
        code: "invalid_signature",
        message: "The wallet signature is malformed.",
      },
    };
  }

  let signer: Address;
  try {
    signer = getAddress(
      await recoverTypedDataAddress({
        ...toReleaseManifestTypedData(validated.data),
        signature: signature.data,
      }),
    );
  } catch {
    return {
      success: false,
      error: {
        code: "invalid_signature",
        message: "The wallet signature could not be verified.",
      },
    };
  }
  if (signer !== validated.data.specification.owner) {
    return {
      success: false,
      error: {
        code: "wrong_signer",
        message: "Only the contract owner can approve this release.",
      },
    };
  }

  return {
    success: true,
    data: {
      approvedAt: nowUnixSeconds,
      digest: hashReleaseManifest(validated.data),
      manifest: validated.data,
      signature: signature.data,
      signer,
    },
  };
}
