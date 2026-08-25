import { Agent, type Model } from "@openai/agents";

import {
  buildAgentOutputSchema,
  deploymentAgentOutputSchema,
  specificationAgentOutputSchema,
  verificationAgentOutputSchema,
  witnessAgentOutputSchema,
} from "./schemas.js";
import {
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
  build: `You are SwarmShip's Build Agent. You may only request the fixed Rust Stylus task-registry renderer through render_task_registry. Call that tool exactly once. You cannot run a compiler, change approval data, access a wallet, or use the chain. Summarize the tool result without changing its status.`,
  verification: `You are SwarmShip's Verification Agent. You may only call run_release_verification exactly once. The tool runs deterministic compilation and tests. Report its status plainly. Never turn a failed or blocked result into a pass, never alter source, and never request deployment.`,
  deployment: `You are SwarmShip's Deployment Agent. You may only call request_guarded_deployment exactly once. The tool independently checks persisted state, deterministic evidence, the exact user signature, and unresolved chain attempts. Report the tool status without claiming success from intent. You cannot read secrets or select a different release.`,
  witness: `You are SwarmShip's Witness Agent. You may only call read_independent_evidence exactly once. The tool reads through the separate witness RPC and decides whether deployment evidence matches. Report mismatches and unknown outcomes honestly. Never trust another agent's success statement and never modify or deploy a contract.`,
} as const;

export type SwarmShipAgents = ReturnType<typeof createSwarmShipAgents>;

export function createSwarmShipAgents(options: {
  model: string | Model;
  executors: AgentToolExecutors;
}) {
  const tools = createAgentTools(options.executors);
  const boundedModel = {
    retry: { maxRetries: 0 },
    timeoutMs: 45_000,
  } as const;
  const requiredTool = { ...boundedModel, toolChoice: "required" as const };

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
    build: new Agent<SwarmShipAgentContext, typeof buildAgentOutputSchema>({
      name: "SwarmShip Build Agent",
      instructions: AGENT_INSTRUCTIONS.build,
      model: options.model,
      modelSettings: requiredTool,
      outputType: buildAgentOutputSchema,
      tools: [tools.build],
      handoffs: [],
    }),
    verification: new Agent<
      SwarmShipAgentContext,
      typeof verificationAgentOutputSchema
    >({
      name: "SwarmShip Verification Agent",
      instructions: AGENT_INSTRUCTIONS.verification,
      model: options.model,
      modelSettings: requiredTool,
      outputType: verificationAgentOutputSchema,
      tools: [tools.verification],
      handoffs: [],
    }),
    deployment: new Agent<
      SwarmShipAgentContext,
      typeof deploymentAgentOutputSchema
    >({
      name: "SwarmShip Deployment Agent",
      instructions: AGENT_INSTRUCTIONS.deployment,
      model: options.model,
      modelSettings: requiredTool,
      outputType: deploymentAgentOutputSchema,
      tools: [tools.deployment],
      handoffs: [],
    }),
    witness: new Agent<SwarmShipAgentContext, typeof witnessAgentOutputSchema>({
      name: "SwarmShip Witness Agent",
      instructions: AGENT_INSTRUCTIONS.witness,
      model: options.model,
      modelSettings: requiredTool,
      outputType: witnessAgentOutputSchema,
      tools: [tools.witness],
      handoffs: [],
    }),
  } as const;
}
