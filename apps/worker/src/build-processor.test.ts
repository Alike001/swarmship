import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel, modelError } from "@openai/agents/testing";
import type {
  BuildRepository,
  LeaseRepository,
  ReleaseLease,
} from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import { processOneBuild } from "./build-processor.js";

const specification = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function lease(): ReleaseLease {
  return {
    token: "00000000-0000-4000-8000-000000000001",
    release: {
      id: "00000000-0000-4000-8000-000000000002",
      state: "specified",
      version: 1,
      reconciliationKind: null,
      specification,
    } as unknown as ReleaseLease["release"],
  };
}

describe("Build Agent processor", () => {
  it("runs one renderer tool and records its deterministic evidence", async () => {
    const model = new ScriptedModel([
      response({
        type: "function_call",
        callId: "render-1",
        name: "render_task_registry",
        status: "completed",
        arguments: "{}",
      }),
      response({
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              summary: "The fixed Rust registry and test inputs were rendered.",
              toolStatus: "rendered",
            }),
          },
        ],
      }),
    ]);
    const builds = { record: vi.fn(async () => ({ id: "1" })) };
    const leases = {
      claimNext: vi.fn(async () => lease()),
      defer: vi.fn(async () => undefined),
    };

    await expect(
      processOneBuild({
        builds: builds as unknown as Pick<BuildRepository, "record">,
        leaseSeconds: 60,
        leases: leases as Pick<LeaseRepository, "claimNext" | "defer">,
        model,
        nowUnixSeconds: () => 1_800_000_000,
        retrySeconds: 300,
        workerId: "build-worker",
      }),
    ).resolves.toMatchObject({ status: "processed" });

    expect(leases.claimNext).toHaveBeenCalledWith("build-worker", 60, [
      "specified",
      "verification_failed",
    ]);
    expect(builds.record).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ event: "build_started" }),
        evidence: expect.objectContaining({
          sourceHash:
            "0xc86aaddfc71c1bad482ec8a45b0dd1284736ac48236bd68fe387d231220fffd1",
          testInputHash:
            "0x2917f736fdf5bf1ebc0e52c0aaaadc2e613b1a1186d7661820582dcc9b95e166",
        }),
      }),
    );
    expect(leases.defer).not.toHaveBeenCalled();
  });

  it("does not claim work when no build release is ready", async () => {
    const leases = {
      claimNext: vi.fn(async () => null),
      defer: vi.fn(async () => undefined),
    };

    await expect(
      processOneBuild({
        builds: { record: vi.fn() },
        leaseSeconds: 60,
        leases: leases as Pick<LeaseRepository, "claimNext" | "defer">,
        model: new ScriptedModel(),
        retrySeconds: 300,
        workerId: "build-worker",
      }),
    ).resolves.toEqual({ status: "idle" });
  });

  it("defers provider failure without recording build evidence", async () => {
    const builds = { record: vi.fn() };
    const leases = {
      claimNext: vi.fn(async () => lease()),
      defer: vi.fn(async () => undefined),
    };
    const model = new ScriptedModel([
      modelError(new Error("private provider response"), { suggested: false }),
    ]);

    await expect(
      processOneBuild({
        builds: builds as unknown as Pick<BuildRepository, "record">,
        leaseSeconds: 60,
        leases: leases as Pick<LeaseRepository, "claimNext" | "defer">,
        model,
        retrySeconds: 300,
        workerId: "build-worker",
      }),
    ).resolves.toMatchObject({
      code: "model_unavailable",
      status: "deferred",
    });
    expect(builds.record).not.toHaveBeenCalled();
    expect(leases.defer).toHaveBeenCalledWith(
      lease().release.id,
      "build-worker",
      lease().token,
      {
        code: "model_unavailable",
        message: "The build agent could not complete its work.",
      },
      300,
    );
  });
});
