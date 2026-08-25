import { OpenAIChatCompletionsModel } from "@openai/agents";
import { describe, expect, it } from "vitest";

import { createConfiguredAgentModel } from "./provider.js";

describe("agent provider configuration", () => {
  it("uses the free Gemini-compatible path by default", () => {
    const configured = createConfiguredAgentModel({
      GEMINI_API_KEY: "test-gemini-key",
    });

    expect(configured.provider).toBe("gemini");
    expect(configured.modelName).toBe("gemini-3.1-flash-lite");
    expect(configured.model).toBeInstanceOf(OpenAIChatCompletionsModel);
  });

  it("supports an explicit model without exposing the credential", () => {
    const configured = createConfiguredAgentModel({
      GEMINI_API_KEY: "must-not-appear",
      SWARMSHIP_AGENT_MODEL: "gemini-3.7-flash",
      SWARMSHIP_AGENT_PROVIDER: "gemini",
    });

    expect(configured).toMatchObject({
      modelName: "gemini-3.7-flash",
      provider: "gemini",
    });
    expect(JSON.stringify(configured)).not.toContain("must-not-appear");
  });

  it("requires the credential selected by the provider", () => {
    expect(() =>
      createConfiguredAgentModel({ OPENAI_API_KEY: "wrong-provider-key" }),
    ).toThrow("GEMINI_API_KEY is required for gemini.");
  });

  it("rejects unsupported providers before creating a client", () => {
    expect(() =>
      createConfiguredAgentModel({
        GEMINI_API_KEY: "test-gemini-key",
        SWARMSHIP_AGENT_PROVIDER: "unknown",
      }),
    ).toThrow("SWARMSHIP_AGENT_PROVIDER must be gemini or openai.");
  });

  it("retains an explicit OpenAI fallback", () => {
    const configured = createConfiguredAgentModel({
      OPENAI_API_KEY: "test-openai-key",
      SWARMSHIP_AGENT_PROVIDER: "openai",
    });

    expect(configured.provider).toBe("openai");
    expect(configured.modelName).toBe("gpt-5-mini");
  });
});
