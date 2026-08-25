import {
  applyReleaseTransition,
  validateTaskRegistrySpec,
  type ReleaseSnapshot,
  type ReleaseTransitionCommand,
  type TaskRegistrySpecV1,
} from "@swarmship/domain/release";
import { z } from "zod";

import { AgentRuntimeError } from "./runtime-error.js";
import type { AgentRunResult } from "./runtime.js";
import type { SpecificationAgentOutput } from "./schemas.js";

const evidenceRefSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);

type SpecificationField = SpecificationAgentOutput["missingFields"][number];

function validateNeedsInputSpecification(
  output: SpecificationAgentOutput,
): void {
  const fields: SpecificationField[] = [
    "owner",
    "permittedSender",
    "permittedReceiver",
    "maxHandoffs",
    "expiry",
  ];
  const emptyFields = fields.filter((field) => output[field] === null).sort();
  const declaredFields = [...new Set(output.missingFields)].sort();
  if (
    output.decision !== "needs_input" ||
    emptyFields.length === 0 ||
    emptyFields.length !== declaredFields.length ||
    emptyFields.some((field, index) => field !== declaredFields[index])
  ) {
    throw new AgentRuntimeError(
      "invalid_model_output",
      "The Specification Agent returned an inconsistent missing-field list.",
    );
  }
}

export function extractAcceptedSpecification(
  output: SpecificationAgentOutput,
  nowUnixSeconds: number,
): TaskRegistrySpecV1 {
  if (
    output.decision !== "accepted" ||
    output.missingFields.length !== 0 ||
    output.owner === null ||
    output.permittedSender === null ||
    output.permittedReceiver === null ||
    output.maxHandoffs === null ||
    output.expiry === null
  ) {
    throw new AgentRuntimeError(
      "invalid_model_output",
      "The Specification Agent did not provide every required field.",
    );
  }
  const result = validateTaskRegistrySpec(
    {
      contractFamily: output.contractFamily,
      owner: output.owner,
      permittedSender: output.permittedSender,
      permittedReceiver: output.permittedReceiver,
      maxHandoffs: output.maxHandoffs,
      expiry: output.expiry,
    },
    nowUnixSeconds,
  );
  if (!result.success) {
    throw new AgentRuntimeError(
      "invalid_model_output",
      "The Specification Agent returned an unsupported release specification.",
    );
  }
  return result.data;
}

export function proposeAgentTransition(input: {
  result: AgentRunResult;
  snapshot: ReleaseSnapshot;
  specificationEvidenceRef?: string;
  nowUnixSeconds: number;
}): ReleaseTransitionCommand | null {
  let command: ReleaseTransitionCommand | null;
  if (input.result.role === "specification") {
    const evidenceRef = evidenceRefSchema.parse(input.specificationEvidenceRef);
    if (input.result.output.decision === "accepted") {
      extractAcceptedSpecification(input.result.output, input.nowUnixSeconds);
    } else {
      validateNeedsInputSpecification(input.result.output);
    }
    command = {
      actor: "specification",
      event:
        input.result.output.decision === "accepted"
          ? "specification_accepted"
          : "specification_needs_input",
      expectedVersion: input.snapshot.version,
      evidenceRef,
    };
  } else {
    const record = input.result.toolRecord;
    if (record.role === "build") {
      if (record.result.status === "blocked") return null;
      command = {
        actor: "build",
        event: "build_started",
        expectedVersion: input.snapshot.version,
        evidenceRef: evidenceRefSchema.parse(record.result.evidenceRef),
      };
    } else if (record.role === "verification") {
      if (record.result.status === "blocked") return null;
      command = {
        actor: "verification",
        event:
          record.result.status === "passed"
            ? "verification_passed"
            : "verification_failed",
        expectedVersion: input.snapshot.version,
        evidenceRef: evidenceRefSchema.parse(record.result.evidenceRef),
      };
    } else {
      if (record.result.status === "blocked") return null;
      command = {
        actor: record.role,
        event: record.result.event,
        expectedVersion: input.snapshot.version,
        evidenceRef: evidenceRefSchema.parse(record.result.evidenceRef),
      };
    }
  }

  const checked = applyReleaseTransition(input.snapshot, command);
  if (!checked.success) {
    throw new AgentRuntimeError("transition_rejected", checked.error.message);
  }
  return command;
}
