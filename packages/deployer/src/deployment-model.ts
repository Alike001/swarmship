import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value as `0x${string}`);
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as `0x${string}`);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const deploymentConstructorSchema = z.strictObject({
  expiry: z.number().int().positive(),
  maxHandoffs: z.number().int().positive(),
  owner: address,
  permittedReceiver: address,
  permittedSender: address,
});

export const deploymentAttemptSchema = z.strictObject({
  approvalDigest: bytes32,
  artifactHash: bytes32,
  constructor: deploymentConstructorSchema,
  contractAddress: address.nullable(),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sender: address,
  startBlock: decimal,
  status: z.enum([
    "prepared",
    "running",
    "observed",
    "confirmed",
    "reverted",
    "unknown",
  ]),
  transactionHash: bytes32.nullable(),
  verificationStatus: z.enum(["pending", "passed", "failed"]),
  version: z.literal(1),
});

export type DeploymentConstructor = z.infer<typeof deploymentConstructorSchema>;
export type DeploymentAttempt = z.infer<typeof deploymentAttemptSchema>;

export type StylusDeploymentResult =
  | {
      status: "observed";
      contractAddress: `0x${string}`;
      transactionHash: `0x${string}`;
    }
  | {
      status: "unknown";
      reason:
        | "command_exception"
        | "command_failed"
        | "command_timed_out"
        | "constructor_invalid"
        | "insufficient_funds"
        | "output_invalid"
        | "output_limit_exceeded"
        | "rpc_unavailable"
        | "transaction_reverted";
    };

export type StylusVerificationResult =
  | { status: "passed" }
  | {
      status: "failed";
      reason:
        | "artifact_mismatch"
        | "command_exception"
        | "command_failed"
        | "command_timed_out"
        | "output_invalid"
        | "output_limit_exceeded"
        | "rpc_unavailable";
    };

export type StylusEstimateResult =
  | {
      status: "estimated";
      dataFeeEth: string;
      gasPriceGwei: string;
      reportedGasWithMixedUnits: string;
      reportedTotalCostEthWithMixedUnits: string;
      warning: "cargo_stylus_0_10_9_mixed_wei_into_gas";
    }
  | {
      status: "failed";
      reason:
        | "command_failed"
        | "command_timed_out"
        | "constructor_invalid"
        | "insufficient_funds"
        | "output_invalid"
        | "rpc_unavailable";
    };
