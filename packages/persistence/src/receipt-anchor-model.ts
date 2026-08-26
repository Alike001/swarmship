import {
  releaseReceiptSchema,
  type ReleaseReceiptV1,
} from "@swarmship/domain/release";
import { z } from "zod";

const bytes32 = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as `0x${string}`);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value as `0x${string}`);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const receiptEvidenceSchema = z.strictObject({
  version: z.literal(1),
  receipt: releaseReceiptSchema,
  receiptRoot: bytes32,
  officialChainId: z.literal(421614),
  witnessChainId: z.literal(421614),
});

export type ReceiptEvidenceV1 = z.infer<typeof receiptEvidenceSchema> & {
  receipt: ReleaseReceiptV1;
};

const existingAttempt = z.strictObject({
  kind: z.literal("existing"),
  proofRoot: bytes32,
  status: z.enum(["existing", "confirmed"]),
  submitter: address,
  timestamp: decimal,
  transactionHash: bytes32.nullable(),
  version: z.literal(1),
});

const preparedAttempt = z.strictObject({
  kind: z.literal("prepared"),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  proofRoot: bytes32,
  sender: address,
  startBlock: decimal,
  status: z.enum([
    "prepared",
    "broadcasting",
    "submitted",
    "confirmed",
    "reverted",
    "unknown",
  ]),
  transactionHash: bytes32.nullable(),
  version: z.literal(1),
});

export const receiptAnchorAttemptSchema = z.discriminatedUnion("kind", [
  existingAttempt,
  preparedAttempt,
]);

export type ReceiptAnchorAttempt = z.infer<typeof receiptAnchorAttemptSchema>;
