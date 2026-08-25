import { createHash } from "node:crypto";

import { validateBuildEvidence } from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import { z } from "zod";

import {
  VERIFICATION_VERSION,
  VerifierError,
  hashVerificationValue,
  verificationCheckPlan,
  type VerificationEvidenceV1,
} from "./verification-model.js";

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/) as z.ZodType<`0x${string}`>;
const checkSchema = z.strictObject({
  args: z.array(z.string().min(1).max(180)).max(12),
  command: z.enum(["cargo"]),
  exitCode: z.number().int().nullable(),
  name: z.enum(["rust_format", "rust_tests", "wasm_build", "stylus_check"]),
  status: z.enum(["passed", "failed"]),
});
const toolchainSchema = z.strictObject({
  cargo: z
    .string()
    .min(1)
    .max(240)
    .regex(/^cargo 1\.96\.0(?: |$)/),
  cargoStylus: z
    .string()
    .min(1)
    .max(240)
    .regex(/^stylus 0\.10\.9$/),
  rustc: z
    .string()
    .min(1)
    .max(240)
    .regex(/^rustc 1\.96\.0(?: |$)/),
});
const artifactBase64Schema = z
  .string()
  .min(4)
  .max(666_668)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const evidenceSchema = z.strictObject({
  artifactBase64: artifactBase64Schema.nullable(),
  artifactHash: bytes32Schema.nullable(),
  buildEvidenceRef: bytes32Schema,
  checks: z.array(checkSchema).min(1).max(4),
  evidenceRef: bytes32Schema,
  status: z.enum(["passed", "failed"]),
  testEvidenceHash: bytes32Schema,
  toolchain: toolchainSchema,
  toolchainHash: bytes32Schema,
  version: z.literal(VERIFICATION_VERSION),
});

function artifactHash(value: string): `0x${string}` {
  return `0x${createHash("sha256")
    .update("swarmship-wasm-artifact-v1")
    .update("\0")
    .update(Buffer.from(value, "base64"))
    .digest("hex")}`;
}

export function validateVerificationEvidence(
  verificationInput: unknown,
  buildInput: unknown,
  specification: TaskRegistrySpecV1,
  nowUnixSeconds: number,
): VerificationEvidenceV1 {
  let build;
  try {
    build = validateBuildEvidence(buildInput, specification, nowUnixSeconds);
  } catch {
    throw new VerifierError(
      "invalid_build_evidence",
      "The verification result refers to invalid build evidence.",
    );
  }
  const parsed = evidenceSchema.safeParse(verificationInput);
  if (!parsed.success) {
    throw new VerifierError(
      "workspace_invalid",
      "The verification evidence is malformed.",
    );
  }
  const evidence = parsed.data;
  const expectedArtifactHash =
    evidence.artifactBase64 === null
      ? null
      : artifactHash(evidence.artifactBase64);
  const toolchainHash = hashVerificationValue(
    "swarmship-toolchain-v1",
    evidence.toolchain,
  );
  const testEvidenceHash = hashVerificationValue(
    "swarmship-verification-checks-v1",
    evidence.checks,
  );
  const evidenceRef = hashVerificationValue(
    "swarmship-verification-evidence-v1",
    {
      artifactHash: expectedArtifactHash,
      buildEvidenceRef: evidence.buildEvidenceRef,
      status: evidence.status,
      testEvidenceHash,
      toolchainHash,
      version: VERIFICATION_VERSION,
    },
  );
  const allPassed =
    evidence.checks.length === 4 &&
    evidence.checks.every((check) => check.status === "passed");
  const wasmPassed = evidence.checks.some(
    (check) => check.name === "wasm_build" && check.status === "passed",
  );
  const hasArtifact = expectedArtifactHash !== null;
  const canonicalChecks = evidence.checks.every((check, index) => {
    const planned = verificationCheckPlan[index];
    return (
      planned !== undefined &&
      check.name === planned.name &&
      check.command === planned.command &&
      JSON.stringify(check.args) === JSON.stringify(planned.args)
    );
  });
  if (
    evidence.buildEvidenceRef !== build.evidenceRef ||
    evidence.artifactHash !== expectedArtifactHash ||
    evidence.toolchainHash !== toolchainHash ||
    evidence.testEvidenceHash !== testEvidenceHash ||
    evidence.evidenceRef !== evidenceRef ||
    !canonicalChecks ||
    wasmPassed !== hasArtifact ||
    (evidence.status === "passed" && !allPassed) ||
    (evidence.status === "failed" && allPassed)
  ) {
    throw new VerifierError(
      "workspace_invalid",
      "The verification evidence does not match its build, checks, or artifact.",
    );
  }
  return evidence as VerificationEvidenceV1;
}
