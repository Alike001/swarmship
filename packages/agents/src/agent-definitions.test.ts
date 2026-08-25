import { ScriptedModel } from "@openai/agents/testing";
import { describe, expect, it } from "vitest";

import { AGENT_INSTRUCTIONS, AGENT_ROLES } from "./agents.js";
import { AGENT_TOOL_NAMES } from "./tools.js";
import { createTestAgents } from "./__tests__/helpers.js";

describe("SwarmShip agent definitions", () => {
  it("creates five distinct agents without handoffs", () => {
    const agents = createTestAgents(new ScriptedModel());

    expect(Object.keys(agents)).toEqual(AGENT_ROLES);
    expect(new Set(Object.values(agents).map((agent) => agent.name)).size).toBe(
      5,
    );
    for (const agent of Object.values(agents))
      expect(agent.handoffs).toEqual([]);
  });

  it("exposes only the tool allowed for each role", () => {
    const agents = createTestAgents(new ScriptedModel());

    expect(agents.specification.tools).toEqual([]);
    expect(agents.build.tools.map((tool) => tool.name)).toEqual([
      AGENT_TOOL_NAMES.build,
    ]);
    expect(agents.verification.tools.map((tool) => tool.name)).toEqual([
      AGENT_TOOL_NAMES.verification,
    ]);
    expect(agents.deployment.tools.map((tool) => tool.name)).toEqual([
      AGENT_TOOL_NAMES.deployment,
    ]);
    expect(agents.witness.tools.map((tool) => tool.name)).toEqual([
      AGENT_TOOL_NAMES.witness,
    ]);
  });

  it("requires every tool-bearing agent to call its tool", () => {
    const agents = createTestAgents(new ScriptedModel());

    expect(agents.build.modelSettings.toolChoice).toBe("required");
    expect(agents.verification.modelSettings.toolChoice).toBe("required");
    expect(agents.deployment.modelSettings.toolChoice).toBe("required");
    expect(agents.witness.modelSettings.toolChoice).toBe("required");
  });

  it("bounds every provider call within the worker lease", () => {
    const agents = createTestAgents(new ScriptedModel());

    for (const agent of Object.values(agents)) {
      expect(agent.modelSettings.timeoutMs).toBe(45_000);
      expect(agent.modelSettings.retry?.maxRetries).toBe(0);
    }
  });

  it("states the security boundaries in role instructions", () => {
    expect(AGENT_INSTRUCTIONS.specification).toContain("no tools");
    expect(AGENT_INSTRUCTIONS.build).toContain("cannot run a compiler");
    expect(AGENT_INSTRUCTIONS.verification).toContain("Never turn a failed");
    expect(AGENT_INSTRUCTIONS.deployment).toContain("exact user signature");
    expect(AGENT_INSTRUCTIONS.witness).toContain("separate witness RPC");
  });
});
