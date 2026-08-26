import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Use a 20-byte EVM address.");
const evidenceRefSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Use a 32-byte evidence reference.");

export const specificationAgentOutputSchema = z.strictObject({
  decision: z.enum(["accepted", "needs_input"]),
  summary: z.string().min(1).max(600),
  missingFields: z.array(
    z.enum([
      "owner",
      "permittedSender",
      "permittedReceiver",
      "maxHandoffs",
      "expiry",
    ]),
  ),
  contractFamily: z.literal("agent-task-registry-v1"),
  owner: addressSchema.nullable(),
  permittedSender: addressSchema.nullable(),
  permittedReceiver: addressSchema.nullable(),
  maxHandoffs: z.number().int().positive().nullable(),
  expiry: z.number().int().positive().nullable(),
});

export const buildAgentOutputSchema = z.strictObject({
  summary: z.string().min(1).max(600),
  toolStatus: z.enum(["rendered", "blocked"]),
});

export const verificationAgentOutputSchema = z.strictObject({
  summary: z.string().min(1).max(600),
  toolStatus: z.enum(["passed", "failed", "blocked"]),
});

export const deploymentAgentOutputSchema = z.strictObject({
  summary: z.string().min(1).max(600),
  toolStatus: z.enum(["accepted", "blocked", "unknown"]),
});

export const witnessAgentOutputSchema = z.strictObject({
  summary: z.string().min(1).max(600),
  toolStatus: z.enum(["verified", "mismatch", "blocked", "unknown"]),
});

export const buildToolResultSchema = z.strictObject({
  status: z.enum(["rendered", "blocked"]),
  evidenceRef: evidenceRefSchema,
  sourceHash: evidenceRefSchema.nullable(),
  testInputHash: evidenceRefSchema.nullable(),
});

export const verificationToolResultSchema = z.strictObject({
  status: z.enum(["passed", "failed", "blocked"]),
  evidenceRef: evidenceRefSchema,
  checks: z.array(z.string().min(1).max(120)).max(12),
});

export const deploymentToolResultSchema = z.strictObject({
  status: z.enum(["accepted", "blocked", "unknown"]),
  evidenceRef: evidenceRefSchema,
  event: z.enum([
    "manifest_anchor_started",
    "manifest_anchor_confirmed",
    "manifest_anchor_reverted",
    "manifest_anchor_unknown",
    "deployment_started",
    "deployment_observed",
    "deployment_reverted",
    "deployment_unknown",
    "manifest_anchor_reconciled_missing",
    "manifest_anchor_reconciled_present",
    "deployment_reconciled_missing",
    "deployment_reconciled_present",
    "deployment_verification_rejected",
  ]),
});

export const witnessToolResultSchema = z.strictObject({
  status: z.enum(["verified", "mismatch", "blocked", "unknown"]),
  evidenceRef: evidenceRefSchema,
  event: z.enum([
    "witness_confirmed",
    "witness_rejected",
    "receipt_anchor_confirmed",
    "receipt_anchor_reverted",
    "receipt_anchor_unknown",
    "receipt_anchor_reconciled_missing",
    "receipt_anchor_reconciled_present",
  ]),
});

export type SpecificationAgentOutput = z.infer<
  typeof specificationAgentOutputSchema
>;
export type BuildAgentOutput = z.infer<typeof buildAgentOutputSchema>;
export type VerificationAgentOutput = z.infer<
  typeof verificationAgentOutputSchema
>;
export type DeploymentAgentOutput = z.infer<typeof deploymentAgentOutputSchema>;
export type WitnessAgentOutput = z.infer<typeof witnessAgentOutputSchema>;
export type BuildToolResult = z.infer<typeof buildToolResultSchema>;
export type VerificationToolResult = z.infer<
  typeof verificationToolResultSchema
>;
export type DeploymentToolResult = z.infer<typeof deploymentToolResultSchema>;
export type WitnessToolResult = z.infer<typeof witnessToolResultSchema>;
