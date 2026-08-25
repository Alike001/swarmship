import type { Model } from "@openai/agents";

import { createSwarmShipAgents } from "../agents.js";
import type { AgentToolExecutors } from "../tools.js";

export const HASH_A = `0x${"1".repeat(64)}`;
export const HASH_B = `0x${"2".repeat(64)}`;
export const HASH_C = `0x${"3".repeat(64)}`;

export function createTestExecutors(
  overrides: Partial<AgentToolExecutors> = {},
): AgentToolExecutors {
  return {
    renderTaskRegistry: async () => ({
      status: "rendered",
      evidenceRef: HASH_A,
      sourceHash: HASH_B,
      testInputHash: HASH_C,
    }),
    runReleaseVerification: async () => ({
      status: "passed",
      evidenceRef: HASH_A,
      checks: ["cargo test", "cargo stylus check"],
    }),
    requestGuardedDeployment: async () => ({
      status: "accepted",
      evidenceRef: HASH_A,
      event: "manifest_anchor_started",
    }),
    readIndependentEvidence: async () => ({
      status: "verified",
      evidenceRef: HASH_A,
      event: "witness_confirmed",
    }),
    ...overrides,
  };
}

export function createTestAgents(
  model: Model,
  overrides: Partial<AgentToolExecutors> = {},
) {
  return createSwarmShipAgents({
    model,
    executors: createTestExecutors(overrides),
  });
}
