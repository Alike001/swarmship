import {
  ModelBehaviorError,
  Runner,
  type Agent,
  type AgentOutputType,
} from "@openai/agents";
import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { z } from "zod";

import type { AgentRole, SwarmShipAgents } from "./agents.js";
import { classifyModelProviderError } from "./provider-error.js";
import { selectRunnableAgent } from "./routing.js";
import { AgentRuntimeError } from "./runtime-error.js";
import {
  buildAgentOutputSchema,
  deploymentAgentOutputSchema,
  specificationAgentOutputSchema,
  verificationAgentOutputSchema,
  witnessAgentOutputSchema,
  type BuildAgentOutput,
  type DeploymentAgentOutput,
  type SpecificationAgentOutput,
  type VerificationAgentOutput,
  type WitnessToolResult,
  type WitnessAgentOutput,
} from "./schemas.js";
import type { AgentToolRecord, SwarmShipAgentContext } from "./tools.js";

export type AgentRunResult =
  | {
      role: "specification";
      output: SpecificationAgentOutput;
      toolRecord: null;
    }
  | { role: "build"; output: BuildAgentOutput; toolRecord: AgentToolRecord }
  | {
      role: "verification";
      output: VerificationAgentOutput;
      toolRecord: AgentToolRecord;
    }
  | {
      role: "deployment";
      output: DeploymentAgentOutput;
      toolRecord: AgentToolRecord;
    }
  | {
      role: "witness";
      output: WitnessAgentOutput;
      toolRecord: AgentToolRecord;
    };

async function runTypedAgent<TOutput extends AgentOutputType>(
  runner: Runner,
  agent: Agent<SwarmShipAgentContext, TOutput>,
  input: string,
  context: SwarmShipAgentContext,
): Promise<unknown> {
  const result = await runner.run(agent, input, {
    context,
    maxTurns: 3,
  });
  return result.finalOutput;
}

function parseTextSummary(role: AgentRole, raw: unknown): string {
  try {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)?.[1];
      const candidate = fenced ?? trimmed;
      if (candidate.startsWith("{")) {
        const parsed = z
          .strictObject({ summary: z.string() })
          .passthrough()
          .parse(JSON.parse(candidate));
        return z.string().min(1).max(600).parse(parsed.summary.trim());
      }
      return z.string().min(1).max(600).parse(trimmed);
    }
    return z
      .strictObject({ summary: z.string().min(1).max(600) })
      .passthrough()
      .parse(raw).summary;
  } catch {
    throw new AgentRuntimeError(
      "invalid_model_output",
      `The ${role} agent returned malformed or unsafe output.`,
    );
  }
}

function requiredToolRecord(
  role: Exclude<AgentRole, "specification">,
  journal: AgentToolRecord[],
): AgentToolRecord {
  const [record] = journal;
  if (journal.length !== 1 || record?.role !== role) {
    const observed = journal.map((entry) => entry.role).join(", ") || "none";
    throw new AgentRuntimeError(
      "invalid_tool_execution",
      `The ${role} agent did not execute exactly its permitted tool. Observed ${journal.length} journaled call(s): ${observed}.`,
    );
  }
  return record;
}

function witnessSummary(result: WitnessToolResult): string {
  if (result.event === "witness_confirmed")
    return "The independent Witness matched the deployed contract to the approved release artifact.";
  if (result.event === "receipt_anchor_confirmed")
    return "The independent Witness receipt was anchored and the release now has complete public proof.";
  if (result.event === "receipt_anchor_reconciled_present")
    return "The independent Witness found the receipt anchor already present and completed the public proof.";
  if (result.status === "mismatch")
    return "The independent Witness found a mismatch and rejected the deployment evidence.";
  if (result.status === "blocked")
    return "The independent Witness could not proceed because required release evidence is missing.";
  return "The independent Witness could not safely confirm the chain result yet, so the release was deferred.";
}

export async function runSelectedAgent(input: {
  agents: SwarmShipAgents;
  releaseId: string;
  snapshot: ReleaseSnapshot;
  prompt: string;
  runner?: Runner;
}): Promise<AgentRunResult> {
  const role = selectRunnableAgent(input.snapshot);
  const context: SwarmShipAgentContext = {
    releaseId: input.releaseId,
    snapshot: input.snapshot,
    toolJournal: [],
  };
  const runner =
    input.runner ??
    new Runner({
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
      toolNameCollisionPolicy: "error",
    });

  try {
    if (role === "specification") {
      const raw = await runTypedAgent(
        runner,
        input.agents.specification,
        input.prompt,
        context,
      );
      if (context.toolJournal.length !== 0)
        throw new AgentRuntimeError(
          "invalid_tool_execution",
          "The Specification Agent cannot execute tools.",
        );
      return {
        role,
        output: specificationAgentOutputSchema.parse(raw),
        toolRecord: null,
      };
    }
    if (role === "build") {
      const raw = await runTypedAgent(
        runner,
        input.agents.build,
        input.prompt,
        context,
      );
      const record = requiredToolRecord(role, context.toolJournal);
      return {
        role,
        output: buildAgentOutputSchema.parse({
          summary: parseTextSummary(role, raw),
          toolStatus: record.result.status,
        }),
        toolRecord: record,
      };
    }
    if (role === "verification") {
      const raw = await runTypedAgent(
        runner,
        input.agents.verification,
        input.prompt,
        context,
      );
      const record = requiredToolRecord(role, context.toolJournal);
      return {
        role,
        output: verificationAgentOutputSchema.parse({
          summary: parseTextSummary(role, raw),
          toolStatus: record.result.status,
        }),
        toolRecord: record,
      };
    }
    if (role === "deployment") {
      const raw = await runTypedAgent(
        runner,
        input.agents.deployment,
        input.prompt,
        context,
      );
      const record = requiredToolRecord(role, context.toolJournal);
      return {
        role,
        output: deploymentAgentOutputSchema.parse({
          summary: parseTextSummary(role, raw),
          toolStatus: record.result.status,
        }),
        toolRecord: record,
      };
    }
    await runTypedAgent(runner, input.agents.witness, input.prompt, context);
    const record = requiredToolRecord(role, context.toolJournal);
    return {
      role,
      output: witnessAgentOutputSchema.parse({
        summary: witnessSummary(record.result as WitnessToolResult),
        toolStatus: record.result.status,
      }),
      toolRecord: record,
    };
  } catch (error) {
    if (error instanceof AgentRuntimeError) throw error;
    if (error instanceof ModelBehaviorError || error instanceof z.ZodError) {
      throw new AgentRuntimeError(
        "invalid_model_output",
        `The ${role} agent returned malformed or unsafe output.`,
      );
    }
    throw classifyModelProviderError(role, error);
  }
}
