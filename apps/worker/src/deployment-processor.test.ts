import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel, modelError } from "@openai/agents/testing";
import type {
  DeploymentRepository,
  LeaseRepository,
  ReleaseLease,
} from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  processOneDeployment,
  type DeploymentProcessorDependencies,
} from "./deployment-processor.js";

const DIGEST = `0x${"a".repeat(64)}` as const;
const ARTIFACT = `0x${"b".repeat(64)}` as const;
const RELAYER = "0x0000000000000000000000000000000000000004" as const;

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function model(): ScriptedModel {
  return new ScriptedModel([
    response({
      arguments: "{}",
      callId: "deployment-1",
      name: "request_guarded_deployment",
      status: "completed",
      type: "function_call",
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "The exact approved Stylus release was prepared.",
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
      deploymentAttempt: null,
      id: "00000000-0000-4000-8000-000000000002",
      reconciliationKind: null,
      specification: {
        contractFamily: "agent-task-registry-v1",
        owner: "0x0000000000000000000000000000000000000001",
        permittedSender: "0x0000000000000000000000000000000000000002",
        permittedReceiver: "0x0000000000000000000000000000000000000003",
        maxHandoffs: 5,
        expiry: 2_000_000_000,
      },
      state: "approved_not_deployed",
      version: 6,
    } as unknown as ReleaseLease["release"],
  };
}

function stores(claim: ReleaseLease | null = lease()) {
  return {
    deployments: {
      getAuthorizedDigest: vi.fn(async () => DIGEST),
      markObserved: vi.fn(),
      markReconciledObserved: vi.fn(),
      markRunning: vi.fn(),
      markVerified: vi.fn(),
      recordOutcome: vi.fn(),
      recordPrepared: vi.fn(async () => ({ id: "transition" })),
    } as unknown as DeploymentRepository,
    leases: {
      claimNext: vi.fn(async () => claim),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => claim ?? lease()),
    } as unknown as LeaseRepository,
  };
}

function input(data = stores()): DeploymentProcessorDependencies {
  return {
    ...data,
    confirm: vi.fn(),
    deploy: vi.fn(),
    leaseSeconds: 60,
    model: model(),
    nowUnixSeconds: () => 1_800_000_000,
    prepareArtifact: vi.fn(async () => ARTIFACT),
    prepareChain: vi.fn(async () => ({
      nonce: 8,
      sender: RELAYER,
      startBlock: 100n,
    })),
    reconcile: vi.fn(),
    retrySeconds: 300,
    verify: vi.fn(),
    validateChain: vi.fn(async () => true),
    workerId: "deployment-worker",
  };
}

describe("Deployment Agent Stylus processor", () => {
  it("persists preparation in its first leased step without deploying", async () => {
    const dependencies = input();

    await expect(processOneDeployment(dependencies)).resolves.toMatchObject({
      event: "deployment_started",
      status: "processed",
    });
    expect(dependencies.leases.claimNext).toHaveBeenCalledWith(
      "deployment-worker",
      60,
      ["approved_not_deployed", "deploying", "reconciliation_required"],
      ["deployment"],
    );
    expect(dependencies.deployments.recordPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({
          approvalDigest: DIGEST,
          artifactHash: ARTIFACT,
          status: "prepared",
        }),
        command: expect.objectContaining({ event: "deployment_started" }),
      }),
    );
    expect(dependencies.deploy).not.toHaveBeenCalled();
  });

  it("defers provider failure without preparing chain work", async () => {
    const dependencies = input();
    dependencies.model = new ScriptedModel([
      modelError(new Error("private provider detail"), { suggested: false }),
    ]);

    await expect(processOneDeployment(dependencies)).resolves.toMatchObject({
      code: "model_unavailable",
      status: "deferred",
    });
    expect(dependencies.prepareArtifact).not.toHaveBeenCalled();
    expect(dependencies.prepareChain).not.toHaveBeenCalled();
    expect(dependencies.deploy).not.toHaveBeenCalled();
  });
});
