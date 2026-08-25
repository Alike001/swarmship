import { tool, type RunContext } from "@openai/agents";
import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { z } from "zod";

import {
  buildToolResultSchema,
  deploymentToolResultSchema,
  verificationToolResultSchema,
  witnessToolResultSchema,
  type BuildToolResult,
  type DeploymentToolResult,
  type VerificationToolResult,
  type WitnessToolResult,
} from "./schemas.js";

export const AGENT_TOOL_NAMES = {
  build: "render_task_registry",
  verification: "run_release_verification",
  deployment: "request_guarded_deployment",
  witness: "read_independent_evidence",
} as const;

export type ToolAgentRole = keyof typeof AGENT_TOOL_NAMES;
export type AgentToolResult =
  | BuildToolResult
  | VerificationToolResult
  | DeploymentToolResult
  | WitnessToolResult;

export type AgentToolRecord =
  | {
      role: "build";
      toolName: typeof AGENT_TOOL_NAMES.build;
      result: BuildToolResult;
    }
  | {
      role: "verification";
      toolName: typeof AGENT_TOOL_NAMES.verification;
      result: VerificationToolResult;
    }
  | {
      role: "deployment";
      toolName: typeof AGENT_TOOL_NAMES.deployment;
      result: DeploymentToolResult;
    }
  | {
      role: "witness";
      toolName: typeof AGENT_TOOL_NAMES.witness;
      result: WitnessToolResult;
    };

export type SwarmShipAgentContext = {
  releaseId: string;
  snapshot: ReleaseSnapshot;
  toolJournal: AgentToolRecord[];
};

export type AgentToolExecutors = {
  renderTaskRegistry: (
    context: Readonly<SwarmShipAgentContext>,
  ) => Promise<BuildToolResult>;
  runReleaseVerification: (
    context: Readonly<SwarmShipAgentContext>,
  ) => Promise<VerificationToolResult>;
  requestGuardedDeployment: (
    context: Readonly<SwarmShipAgentContext>,
  ) => Promise<DeploymentToolResult>;
  readIndependentEvidence: (
    context: Readonly<SwarmShipAgentContext>,
  ) => Promise<WitnessToolResult>;
};

const noParametersSchema = z.strictObject({});

function recordResult(
  context: SwarmShipAgentContext,
  record: AgentToolRecord,
): void {
  context.toolJournal.push(record);
}

function requiredContext(
  runContext: RunContext<SwarmShipAgentContext> | undefined,
): SwarmShipAgentContext {
  if (runContext === undefined) {
    throw new Error("SwarmShip agent tool context is required.");
  }
  return runContext.context;
}

export function createAgentTools(executors: AgentToolExecutors) {
  const build = tool({
    name: AGENT_TOOL_NAMES.build,
    description:
      "Render the fixed Rust Stylus task registry and test inputs for this release.",
    parameters: noParametersSchema,
    execute: async (
      _input,
      runContext: RunContext<SwarmShipAgentContext> | undefined,
    ) => {
      const context = requiredContext(runContext);
      const result = buildToolResultSchema.parse(
        await executors.renderTaskRegistry(context),
      );
      recordResult(context, {
        role: "build",
        toolName: AGENT_TOOL_NAMES.build,
        result,
      });
      return result;
    },
  });

  const verification = tool({
    name: AGENT_TOOL_NAMES.verification,
    description:
      "Run the fixed compiler, Stylus compatibility checks, and deterministic release tests.",
    parameters: noParametersSchema,
    execute: async (
      _input,
      runContext: RunContext<SwarmShipAgentContext> | undefined,
    ) => {
      const context = requiredContext(runContext);
      const result = verificationToolResultSchema.parse(
        await executors.runReleaseVerification(context),
      );
      recordResult(context, {
        role: "verification",
        toolName: AGENT_TOOL_NAMES.verification,
        result,
      });
      return result;
    },
  });

  const deployment = tool({
    name: AGENT_TOOL_NAMES.deployment,
    description:
      "Request the state-gated HERŌ anchor, deployment, or reconciliation operation for this release.",
    parameters: noParametersSchema,
    execute: async (
      _input,
      runContext: RunContext<SwarmShipAgentContext> | undefined,
    ) => {
      const context = requiredContext(runContext);
      const result = deploymentToolResultSchema.parse(
        await executors.requestGuardedDeployment(context),
      );
      recordResult(context, {
        role: "deployment",
        toolName: AGENT_TOOL_NAMES.deployment,
        result,
      });
      return result;
    },
  });

  const witness = tool({
    name: AGENT_TOOL_NAMES.witness,
    description:
      "Read deployment evidence through the independent witness RPC and request receipt anchoring only when it matches.",
    parameters: noParametersSchema,
    execute: async (
      _input,
      runContext: RunContext<SwarmShipAgentContext> | undefined,
    ) => {
      const context = requiredContext(runContext);
      const result = witnessToolResultSchema.parse(
        await executors.readIndependentEvidence(context),
      );
      recordResult(context, {
        role: "witness",
        toolName: AGENT_TOOL_NAMES.witness,
        result,
      });
      return result;
    },
  });

  return { build, deployment, verification, witness };
}
