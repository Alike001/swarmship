import { OpenAIChatCompletionsModel, type Model } from "@openai/agents";
import OpenAI from "openai";

export const AGENT_PROVIDERS = ["gemini", "openai"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export interface ConfiguredAgentModel {
  model: Model;
  modelName: string;
  provider: AgentProvider;
}

const defaults: Record<
  AgentProvider,
  { apiKeyName: "GEMINI_API_KEY" | "OPENAI_API_KEY"; model: string }
> = {
  gemini: {
    apiKeyName: "GEMINI_API_KEY",
    model: "gemini-3.1-flash-lite",
  },
  openai: {
    apiKeyName: "OPENAI_API_KEY",
    model: "gpt-5-mini",
  },
};

function readProvider(value: string | undefined): AgentProvider {
  const provider = value?.trim() || "gemini";
  if (!AGENT_PROVIDERS.includes(provider as AgentProvider)) {
    throw new Error("SWARMSHIP_AGENT_PROVIDER must be gemini or openai.");
  }
  return provider as AgentProvider;
}

export function createConfiguredAgentModel(
  environment: Record<string, string | undefined>,
  options: { maxRetries?: number; timeoutMs?: number } = {},
): ConfiguredAgentModel {
  const provider = readProvider(environment.SWARMSHIP_AGENT_PROVIDER);
  const providerDefault = defaults[provider];
  const apiKey = environment[providerDefault.apiKeyName]?.trim();
  if (!apiKey) {
    throw new Error(
      `${providerDefault.apiKeyName} is required for ${provider}.`,
    );
  }
  const modelName =
    environment.SWARMSHIP_AGENT_MODEL?.trim() || providerDefault.model;
  const client = new OpenAI({
    apiKey,
    baseURL:
      provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai/"
        : undefined,
    maxRetries: options.maxRetries ?? 0,
    timeout: options.timeoutMs ?? 45_000,
  });

  return {
    model: new OpenAIChatCompletionsModel(client, modelName),
    modelName,
    provider,
  };
}
