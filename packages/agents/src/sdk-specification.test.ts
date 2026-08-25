import { ScriptedModel } from "@openai/agents/testing";
import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { describe, expect, it } from "vitest";

import { runSelectedAgent } from "./orchestrator.js";
import { createTestAgents } from "./__tests__/helpers.js";
import {
  scriptedAssistantMessage,
  scriptedResponse,
} from "./__tests__/scripted.js";

const createdSnapshot: ReleaseSnapshot = {
  state: "created",
  version: 0,
  reconciliation: null,
};
const specificationOutput = {
  decision: "accepted",
  summary: "A five-use handoff registry owned by the user's address.",
  missingFields: [],
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
} as const;

describe("Specification Agent SDK runtime", () => {
  it("parses structured output without tools", async () => {
    const model = new ScriptedModel([
      scriptedResponse(
        scriptedAssistantMessage(JSON.stringify(specificationOutput)),
      ),
    ]);

    const result = await runSelectedAgent({
      agents: createTestAgents(model),
      releaseId: "release-specification",
      snapshot: createdSnapshot,
      prompt: "Create the bounded registry described in the request.",
    });

    expect(result).toEqual({
      role: "specification",
      output: specificationOutput,
      toolRecord: null,
    });
    expect(model.calls).toHaveLength(1);
    model.assertComplete();
  });
});
