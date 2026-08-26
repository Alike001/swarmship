import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel, modelError } from "@openai/agents/testing";
import type {
  LeaseRepository,
  ManifestAnchorRepository,
  ReleaseLease,
} from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  processOneManifestAnchor,
  type ManifestAnchorProcessorDependencies,
} from "./manifest-anchor-processor.js";

const ROOT = `0x${"a".repeat(64)}` as const;
const SENDER = "0x0000000000000000000000000000000000000001" as const;

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function model(): ScriptedModel {
  return new ScriptedModel([
    response({
      arguments: "{}",
      callId: "anchor-1",
      name: "request_guarded_deployment",
      status: "completed",
      type: "function_call",
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "The approved manifest was prepared.",
          }),
          type: "output_text",
        },
      ],
      role: "assistant",
      status: "completed",
      type: "message",
    }),
  ]);
}

function lease(): ReleaseLease {
  return {
    token: "00000000-0000-4000-8000-000000000001",
    release: {
      id: "00000000-0000-4000-8000-000000000002",
      manifestAnchorAttempt: null,
      reconciliationKind: null,
      state: "approved",
      version: 5,
    } as ReleaseLease["release"],
  };
}

function stores(claim: ReleaseLease | null = lease()) {
  return {
    anchors: {
      getAuthorizedRoot: vi.fn(async () => ROOT),
      markBroadcasting: vi.fn(),
      markSubmitted: vi.fn(),
      recordOutcome: vi.fn(),
      recordPrepared: vi.fn(async () => ({ id: "transition" })),
    } as unknown as Pick<
      ManifestAnchorRepository,
      | "getAuthorizedRoot"
      | "markBroadcasting"
      | "markSubmitted"
      | "recordOutcome"
      | "recordPrepared"
    >,
    leases: {
      claimNext: vi.fn(async () => claim),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => claim ?? lease()),
    } as unknown as Pick<LeaseRepository, "claimNext" | "defer" | "renew">,
  };
}

function processorInput(input = stores()): ManifestAnchorProcessorDependencies {
  return {
    ...input,
    broadcast: vi.fn(),
    confirm: vi.fn(),
    leaseSeconds: 60,
    model: model(),
    nowUnixSeconds: () => 1_800_000_000,
    prepare: vi.fn(async () => ({
      kind: "ready" as const,
      nonce: 7,
      proofRoot: ROOT,
      sender: SENDER,
      startBlock: 100n,
    })),
    reconcile: vi.fn(),
    retrySeconds: 300,
    verify: vi.fn(),
    workerId: "manifest-worker",
  };
}

describe("Deployment Agent manifest-anchor processor", () => {
  it("claims only its states and persists preparation before any broadcast", async () => {
    const input = processorInput();

    await expect(processOneManifestAnchor(input)).resolves.toMatchObject({
      event: "manifest_anchor_started",
      status: "processed",
    });
    expect(input.leases.claimNext).toHaveBeenCalledWith(
      "manifest-worker",
      60,
      ["approved", "anchoring_manifest", "reconciliation_required"],
      ["manifest_anchor"],
    );
    expect(input.anchors.recordPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({
          proofRoot: ROOT,
          status: "prepared",
        }),
        command: expect.objectContaining({ event: "manifest_anchor_started" }),
      }),
    );
    expect(input.broadcast).not.toHaveBeenCalled();
    expect(input.leases.defer).not.toHaveBeenCalled();
  });

  it("defers a provider failure without preparing or broadcasting", async () => {
    const input = processorInput();
    input.model = new ScriptedModel([
      modelError(new Error("private provider detail"), { suggested: false }),
    ]);

    await expect(processOneManifestAnchor(input)).resolves.toMatchObject({
      code: "model_unavailable",
      status: "deferred",
    });
    expect(input.prepare).not.toHaveBeenCalled();
    expect(input.broadcast).not.toHaveBeenCalled();
    expect(input.anchors.recordPrepared).not.toHaveBeenCalled();
  });

  it("stays idle when no approved anchor work is available", async () => {
    const input = processorInput(stores(null));

    await expect(processOneManifestAnchor(input)).resolves.toEqual({
      status: "idle",
    });
    expect(input.prepare).not.toHaveBeenCalled();
  });
});
