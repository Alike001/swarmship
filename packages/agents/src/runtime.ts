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

function requiredToolRecord(
  role: Exclude<AgentRole, "specification">,
  journal: AgentToolRecord[],
): AgentToolRecord {
  const [record] = journal;
  if (journal.length !== 1 || record?.role !== role) {
    throw new AgentRuntimeError(
      "invalid_tool_execution",
      `The ${role} agent did not execute exactly its permitted tool.`,
    );
  }
  return record;
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
      return {
        role,
        output: buildAgentOutputSchema.parse(raw),
        toolRecord: requiredToolRecord(role, context.toolJournal),
      };
    }
    if (role === "verification") {
      const raw = await runTypedAgent(
        runner,
        input.agents.verification,
        input.prompt,
        context,
      );
      return {
        role,
        output: verificationAgentOutputSchema.parse(raw),
        toolRecord: requiredToolRecord(role, context.toolJournal),
      };
    }
    if (role === "deployment") {
      const raw = await runTypedAgent(
        runner,
        input.agents.deployment,
        input.prompt,
        context,
      );
      return {
        role,
        output: deploymentAgentOutputSchema.parse(raw),
        toolRecord: requiredToolRecord(role, context.toolJournal),
      };
    }
    const raw = await runTypedAgent(
      runner,
      input.agents.witness,
      input.prompt,
      context,
    );
    return {
      role,
      output: witnessAgentOutputSchema.parse(raw),
      toolRecord: requiredToolRecord(role, context.toolJournal),
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
