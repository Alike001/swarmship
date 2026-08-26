import type { ReleaseSnapshot } from "@swarmship/domain/release";
import { describe, expect, it } from "vitest";

import {
  AgentRuntimeError,
  extractAcceptedSpecification,
  proposeAgentTransition,
  selectRunnableAgent,
  type AgentRunResult,
} from "./orchestrator.js";
import type { SpecificationAgentOutput } from "./schemas.js";
import { HASH_A } from "./__tests__/helpers.js";

const snapshot = (
  state: ReleaseSnapshot["state"],
  reconciliation: ReleaseSnapshot["reconciliation"] = null,
): ReleaseSnapshot => ({ state, version: 3, reconciliation });

const acceptedSpecification: SpecificationAgentOutput = {
  decision: "accepted",
  summary: "One bounded handoff registry.",
  missingFields: [],
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

describe("agent routing", () => {
  it.each([
    ["created", null, "specification"],
    ["needs_input", null, "specification"],
    ["specified", null, "build"],
    ["verification_failed", null, "build"],
    ["building", null, "verification"],
    ["approved", null, "deployment"],
    ["anchoring_manifest", null, "deployment"],
    ["approved_not_deployed", null, "deployment"],
    ["deploying", null, "deployment"],
    ["deployed_unverified", null, "witness"],
    ["anchoring_receipt", null, "witness"],
    ["reconciliation_required", "deployment", "deployment"],
    ["reconciliation_required", "receipt_anchor", "witness"],
  ] as const)("routes %s to %s", (state, reconciliation, role) => {
    expect(selectRunnableAgent(snapshot(state, reconciliation))).toBe(role);
  });

  it.each([
    ["awaiting_approval", "wait_for_user"],
    ["verified", "terminal_state"],
    ["failed", "terminal_state"],
  ] as const)("rejects %s with %s", (state, code) => {
    expect(() => selectRunnableAgent(snapshot(state))).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe("agent transition proposals", () => {
  it("validates an accepted specification before proposing its transition", () => {
    const result: AgentRunResult = {
      role: "specification",
      output: acceptedSpecification,
      toolRecord: null,
    };

    expect(
      proposeAgentTransition({
        result,
        snapshot: snapshot("created"),
        specificationEvidenceRef: HASH_A,
        nowUnixSeconds: 1_900_000_000,
      }),
    ).toEqual({
      actor: "specification",
      event: "specification_accepted",
      expectedVersion: 3,
      evidenceRef: HASH_A,
    });
  });

  it("uses deterministic verification output instead of model prose", () => {
    const result: AgentRunResult = {
      role: "verification",
      output: { summary: "The model says passed.", toolStatus: "passed" },
      toolRecord: {
        role: "verification",
        toolName: "run_release_verification",
        result: { status: "failed", evidenceRef: HASH_A, checks: ["failed"] },
      },
    };

    expect(
      proposeAgentTransition({
        result,
        snapshot: snapshot("building"),
        nowUnixSeconds: 1_900_000_000,
      })?.event,
    ).toBe("verification_failed");
  });

  it("returns no transition when a deterministic tool is blocked", () => {
    const result: AgentRunResult = {
      role: "build",
      output: { summary: "Blocked.", toolStatus: "blocked" },
      toolRecord: {
        role: "build",
        toolName: "render_task_registry",
        result: {
          status: "blocked",
          evidenceRef: HASH_A,
          sourceHash: null,
          testInputHash: null,
        },
      },
    };

    expect(
      proposeAgentTransition({
        result,
        snapshot: snapshot("specified"),
        nowUnixSeconds: 1_900_000_000,
      }),
    ).toBeNull();
  });

  it("rejects a tool event that does not match persisted state", () => {
    const result: AgentRunResult = {
      role: "deployment",
      output: { summary: "Requested.", toolStatus: "accepted" },
      toolRecord: {
        role: "deployment",
        toolName: "request_guarded_deployment",
        result: {
          status: "accepted",
          evidenceRef: HASH_A,
          event: "deployment_started",
        },
      },
    };

    expect(() =>
      proposeAgentTransition({
        result,
        snapshot: snapshot("approved"),
        nowUnixSeconds: 1_900_000_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "transition_rejected" }));
  });

  it("rejects an accepted specification with missing fields", () => {
    expect(() =>
      extractAcceptedSpecification(
        { ...acceptedSpecification, owner: null },
        1_900_000_000,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeError>>({
        code: "invalid_model_output",
      }),
    );
  });

  it("rejects a needs-input specification with no missing fields", () => {
    const result: AgentRunResult = {
      role: "specification",
      output: {
        ...acceptedSpecification,
        decision: "needs_input",
      },
      toolRecord: null,
    };

    expect(() =>
      proposeAgentTransition({
        result,
        snapshot: snapshot("created"),
        specificationEvidenceRef: HASH_A,
        nowUnixSeconds: 1_900_000_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_model_output" }));
  });

  it("rejects a needs-input specification with an incomplete missing list", () => {
    const result: AgentRunResult = {
      role: "specification",
      output: {
        ...acceptedSpecification,
        decision: "needs_input",
        missingFields: ["owner"],
        owner: null,
        expiry: null,
      },
      toolRecord: null,
    };

    expect(() =>
      proposeAgentTransition({
        result,
        snapshot: snapshot("created"),
        specificationEvidenceRef: HASH_A,
        nowUnixSeconds: 1_900_000_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_model_output" }));
  });
});
