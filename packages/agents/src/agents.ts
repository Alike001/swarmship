import { Agent, type Model } from "@openai/agents";

import { specificationAgentOutputSchema } from "./schemas.js";
import {
  AGENT_TOOL_NAMES,
  createAgentTools,
  type AgentToolExecutors,
  type SwarmShipAgentContext,
} from "./tools.js";

export const AGENT_ROLES = [
  "specification",
  "build",
  "verification",
  "deployment",
  "witness",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_INSTRUCTIONS = {
  specification: `You are SwarmShip's Specification Agent. Convert one user's request into the fixed agent-task-registry-v1 fields only. Never invent an address, limit, or expiry. If a required value is missing or ambiguous, return needs_input and name the missing fields. You have no tools and no authority to build, approve, deploy, or verify anything. Keep the summary understandable without blockchain knowledge.`,
  build: `You are SwarmShip's Build Agent. You may only request the fixed Rust Stylus task-registry renderer through render_task_registry. Call that tool exactly once. You cannot run a compiler, change approval data, access a wallet, or use the chain. After the tool returns, output JSON only with summary and toolStatus. toolStatus must exactly match the tool result.`,
  verification: `You are SwarmShip's Verification Agent. You may only call run_release_verification exactly once. The tool runs deterministic compilation and tests. Never turn a failed or blocked result into a pass, never alter source, and never request deployment. After the tool returns, output JSON only with summary and toolStatus. toolStatus must exactly match the tool result.`,
  deployment: `You are SwarmShip's Deployment Agent. You may only call request_guarded_deployment exactly once. The tool independently checks persisted state, deterministic evidence, the exact user signature, and unresolved chain attempts. You cannot read secrets or select a different release. After the tool returns, output JSON only with summary and toolStatus. toolStatus must exactly match the tool result.`,
  witness: `You are SwarmShip's Witness Agent. You may only call read_independent_evidence exactly once. The tool reads through the separate witness RPC and decides whether deployment evidence matches. Never trust another agent's success statement and never modify or deploy a contract. After the tool returns, output JSON only with summary and toolStatus. toolStatus must exactly match the tool result.`,
} as const;

export type SwarmShipAgents = ReturnType<typeof createSwarmShipAgents>;

export function createSwarmShipAgents(options: {
  model: string | Model;
  executors: AgentToolExecutors;
  witnessModel?: string | Model;
}) {
  const tools = createAgentTools(options.executors);
  const boundedModel = {
    retry: { maxRetries: 0 },
    timeoutMs: 45_000,
  } as const;
  const requiredTool = {
    ...boundedModel,
    parallelToolCalls: false,
    toolChoice: "required" as const,
  };

  return {
    specification: new Agent<
      SwarmShipAgentContext,
      typeof specificationAgentOutputSchema
    >({
      name: "SwarmShip Specification Agent",
      instructions: AGENT_INSTRUCTIONS.specification,
      model: options.model,
      modelSettings: boundedModel,
      outputType: specificationAgentOutputSchema,
      tools: [],
      handoffs: [],
    }),
    build: new Agent<SwarmShipAgentContext, "text">({
      name: "SwarmShip Build Agent",
      instructions: AGENT_INSTRUCTIONS.build,
      model: options.model,
      modelSettings: requiredTool,
      outputType: "text",
      tools: [tools.build],
      handoffs: [],
    }),
    verification: new Agent<SwarmShipAgentContext, "text">({
      name: "SwarmShip Verification Agent",
      instructions: AGENT_INSTRUCTIONS.verification,
      model: options.model,
      modelSettings: requiredTool,
      outputType: "text",
      tools: [tools.verification],
      handoffs: [],
    }),
    deployment: new Agent<SwarmShipAgentContext, "text">({
      name: "SwarmShip Deployment Agent",
      instructions: AGENT_INSTRUCTIONS.deployment,
      model: options.model,
      modelSettings: requiredTool,
      outputType: "text",
      tools: [tools.deployment],
      handoffs: [],
    }),
    witness: new Agent<SwarmShipAgentContext, "text">({
      name: "SwarmShip Witness Agent",
      instructions: AGENT_INSTRUCTIONS.witness,
      model: options.witnessModel ?? options.model,
      modelSettings: {
        ...requiredTool,
        toolChoice: AGENT_TOOL_NAMES.witness,
      },
      toolUseBehavior: "stop_on_first_tool",
      outputType: "text",
      tools: [tools.witness],
      handoffs: [],
    }),
  } as const;
}
