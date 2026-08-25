import { ScriptedModel, modelError } from "@openai/agents/testing";
import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { describe, expect, it } from "vitest";

import { AgentRuntimeError, runSelectedAgent } from "./orchestrator.js";
import { createTestAgents } from "./__tests__/helpers.js";
import {
  scriptedAssistantMessage,
  scriptedFunctionCall,
  scriptedResponse,
} from "./__tests__/scripted.js";

const createdSnapshot: ReleaseSnapshot = {
  state: "created",
  version: 0,
  reconciliation: null,
};
const specifiedSnapshot: ReleaseSnapshot = {
  state: "specified",
  version: 1,
  reconciliation: null,
};

describe("Agent SDK failure boundaries", () => {
  it("rejects malformed structured model output", async () => {
    const model = new ScriptedModel([
      scriptedResponse(
        scriptedAssistantMessage(JSON.stringify({ decision: "accepted" })),
      ),
    ]);

    await expect(
      runSelectedAgent({
        agents: createTestAgents(model),
        releaseId: "release-malformed",
        snapshot: createdSnapshot,
        prompt: "Parse this release.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimeError>>({
        code: "invalid_model_output",
      }),
    );
  });

  it("rejects a Build Agent call to the deployment tool", async () => {
    const model = new ScriptedModel([
      scriptedResponse(
        scriptedFunctionCall("request_guarded_deployment", "forbidden-call-1"),
      ),
    ]);

    await expect(
      runSelectedAgent({
        agents: createTestAgents(model),
        releaseId: "release-forbidden",
        snapshot: specifiedSnapshot,
        prompt: "Attempt an unauthorized deployment.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimeError>>({
        code: "invalid_model_output",
      }),
    );
  });

  it("reports model failure safely without advancing state", async () => {
    const model = new ScriptedModel([
      modelError(new Error("provider detail must stay private"), {
        suggested: false,
      }),
    ]);

    await expect(
      runSelectedAgent({
        agents: createTestAgents(model),
        releaseId: "release-provider-failure",
        snapshot: createdSnapshot,
        prompt: "Parse this release.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimeError>>({
        code: "model_unavailable",
        message: "The specification agent could not complete its work.",
      }),
    );
  });

  it("rejects a non-runnable state before calling the model", async () => {
    const model = new ScriptedModel();

    await expect(
      runSelectedAgent({
        agents: createTestAgents(model),
        releaseId: "release-waiting",
        snapshot: {
          state: "awaiting_approval",
          version: 7,
          reconciliation: null,
        },
        prompt: "Continue without a signature.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimeError>>({
        code: "wait_for_user",
      }),
    );
    expect(model.calls).toHaveLength(0);
  });
});
