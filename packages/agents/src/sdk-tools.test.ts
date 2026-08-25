import { ScriptedModel } from "@openai/agents/testing";
import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { describe, expect, it, vi } from "vitest";

import { AgentRuntimeError, runSelectedAgent } from "./orchestrator.js";
import type { AgentToolExecutors } from "./tools.js";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  createTestAgents,
} from "./__tests__/helpers.js";
import {
  scriptedAssistantMessage,
  scriptedFunctionCall,
  scriptedResponse,
} from "./__tests__/scripted.js";

const specifiedSnapshot: ReleaseSnapshot = {
  state: "specified",
  version: 1,
  reconciliation: null,
};

describe("tool-bearing Agent SDK runtime", () => {
  it("executes exactly the Build Agent's permitted tool", async () => {
    const model = new ScriptedModel([
      scriptedResponse(
        scriptedFunctionCall("render_task_registry", "build-call-1"),
      ),
      scriptedResponse(
        scriptedAssistantMessage(
          JSON.stringify({
            summary: "The fixed registry and its test inputs were rendered.",
            toolStatus: "blocked",
          }),
        ),
      ),
    ]);
    const renderTaskRegistry = vi.fn(async () => ({
      status: "rendered" as const,
      evidenceRef: HASH_A,
      sourceHash: HASH_B,
      testInputHash: HASH_C,
    }));

    const result = await runSelectedAgent({
      agents: createTestAgents(model, { renderTaskRegistry }),
      releaseId: "release-build",
      snapshot: specifiedSnapshot,
      prompt: "Render the accepted fixed specification.",
    });

    expect(result.role).toBe("build");
    if (result.role !== "build")
      throw new Error("Expected Build Agent result.");
    expect(result.toolRecord).toEqual({
      role: "build",
      toolName: "render_task_registry",
      result: {
        status: "rendered",
        evidenceRef: HASH_A,
        sourceHash: HASH_B,
        testInputHash: HASH_C,
      },
    });
    expect(result.output.toolStatus).toBe("rendered");
    expect(renderTaskRegistry).toHaveBeenCalledOnce();
    expect(renderTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: "release-build",
        snapshot: specifiedSnapshot,
      }),
    );
    expect(model.calls).toHaveLength(2);
    model.assertComplete();
  });

  it("rejects malformed executor output before journaling it", async () => {
    const model = new ScriptedModel([
      scriptedResponse(
        scriptedFunctionCall("render_task_registry", "build-call-invalid"),
      ),
      scriptedResponse(
        scriptedAssistantMessage(
          JSON.stringify({
            summary: "The renderer result was invalid.",
            toolStatus: "blocked",
          }),
        ),
      ),
    ]);
    const renderTaskRegistry = vi.fn(async () => ({
      status: "rendered",
      evidenceRef: "not-a-hash",
      sourceHash: null,
      testInputHash: null,
    }));

    await expect(
      runSelectedAgent({
        agents: createTestAgents(model, {
          renderTaskRegistry:
            renderTaskRegistry as unknown as AgentToolExecutors["renderTaskRegistry"],
        }),
        releaseId: "release-invalid-build",
        snapshot: specifiedSnapshot,
        prompt: "Render the accepted fixed specification.",
      }),
    ).rejects.toMatchObject({
      code: "invalid_tool_execution",
    } satisfies Partial<AgentRuntimeError>);
  });
});
