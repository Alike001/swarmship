import {
  TASK_REGISTRY_CONTRACT_FAMILY,
  validateTaskRegistrySpec,
} from "@swarmship/domain/release";
import { z } from "zod";

import {
  BUILD_TEMPLATE_FILES,
  BUILD_TEMPLATE_VERSION,
  BuildRendererError,
  hashBuildValue,
  type BuildEvidenceV1,
} from "./renderer.js";

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/) as z.ZodType<`0x${string}`>;
const sourceFileSchema = z.strictObject({
  content: z.string().min(1).max(160_000),
  path: z.enum(BUILD_TEMPLATE_FILES),
});
const testInputsSchema = z.strictObject({
  constructor: z.strictObject({
    expiry: z.number().int().positive(),
    maxHandoffs: z.number().int().positive(),
    owner: z.string(),
    permittedReceiver: z.string(),
    permittedSender: z.string(),
  }),
  requiredChecks: z.tuple([
    z.literal("authorized_handoff"),
    z.literal("unauthorized_sender"),
    z.literal("duplicate_task"),
    z.literal("maximum_handoff_limit"),
    z.literal("expired_mandate"),
  ]),
  version: z.literal(1),
});
const buildEvidenceSchema = z
  .strictObject({
    contractFamily: z.literal("agent-task-registry-v1"),
    evidenceRef: bytes32Schema,
    sourceFiles: z.array(sourceFileSchema).length(BUILD_TEMPLATE_FILES.length),
    sourceHash: bytes32Schema,
    templateVersion: z.literal(BUILD_TEMPLATE_VERSION),
    testInputHash: bytes32Schema,
    testInputs: testInputsSchema,
    version: z.literal(1),
  })
  .superRefine((evidence, context) => {
    if (
      evidence.sourceFiles.some(
        (file, index) => file.path !== BUILD_TEMPLATE_FILES[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Build source files are not in the canonical order.",
        path: ["sourceFiles"],
      });
    }
    const totalLength = evidence.sourceFiles.reduce(
      (total, file) => total + file.content.length,
      0,
    );
    if (totalLength > 300_000) {
      context.addIssue({
        code: "custom",
        message: "The build source bundle is too large.",
        path: ["sourceFiles"],
      });
    }
  });

export function validateBuildEvidence(
  evidenceInput: unknown,
  specificationInput: unknown,
  nowUnixSeconds: number,
): BuildEvidenceV1 {
  const specification = validateTaskRegistrySpec(
    specificationInput,
    nowUnixSeconds,
  );
  const evidence = buildEvidenceSchema.safeParse(evidenceInput);
  if (!specification.success || !evidence.success) {
    throw new BuildRendererError(
      "invalid_specification",
      "The build evidence or accepted specification is invalid.",
    );
  }
  const expectedConstructor = {
    expiry: specification.data.expiry,
    maxHandoffs: specification.data.maxHandoffs,
    owner: specification.data.owner,
    permittedReceiver: specification.data.permittedReceiver,
    permittedSender: specification.data.permittedSender,
  };
  const sourceHash = hashBuildValue(
    "swarmship-source-bundle-v1",
    evidence.data.sourceFiles,
  );
  const testInputHash = hashBuildValue(
    "swarmship-test-inputs-v1",
    evidence.data.testInputs,
  );
  const evidenceRef = hashBuildValue("swarmship-build-evidence-v1", {
    contractFamily: TASK_REGISTRY_CONTRACT_FAMILY,
    sourceHash,
    templateVersion: BUILD_TEMPLATE_VERSION,
    testInputHash,
    version: 1,
  });
  if (
    JSON.stringify(evidence.data.testInputs.constructor) !==
      JSON.stringify(expectedConstructor) ||
    evidence.data.sourceHash !== sourceHash ||
    evidence.data.testInputHash !== testInputHash ||
    evidence.data.evidenceRef !== evidenceRef
  ) {
    throw new BuildRendererError(
      "template_invalid",
      "The build evidence does not match its source or specification.",
    );
  }
  return evidence.data as BuildEvidenceV1;
}
