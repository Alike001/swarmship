import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel, modelError } from "@openai/agents/testing";
import type {
  LeaseRepository,
  ReleaseLease,
  VerificationRepository,
} from "@swarmship/persistence";
import {
  VERIFICATION_VERSION,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";
import { describe, expect, it, vi } from "vitest";

import { processOneVerification } from "./verification-processor.js";

const HASH_A = `0x${"a".repeat(64)}` as const;
const HASH_B = `0x${"b".repeat(64)}` as const;
const HASH_C = `0x${"c".repeat(64)}` as const;
const HASH_D = `0x${"d".repeat(64)}` as const;
const HASH_E = `0x${"e".repeat(64)}` as const;
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
      buildEvidence: { evidenceRef: HASH_A },
      id: "00000000-0000-4000-8000-000000000002",
      reconciliationKind: null,
      specification,
      state: "building",
      version: 2,
    } as unknown as ReleaseLease["release"],
  };
}

function evidence(
  status: "passed" | "failed" = "passed",
): VerificationEvidenceV1 {
  return {
    artifactBase64: status === "passed" ? "d2FzbQ==" : null,
    artifactHash: status === "passed" ? HASH_B : null,
    buildEvidenceRef: HASH_A,
    checks: [
      {
        args: ["test"],
        command: "cargo",
        exitCode: status === "passed" ? 0 : 101,
        name: "rust_tests",
        status,
      },
    ],
    evidenceRef: HASH_C,
    status,
    testEvidenceHash: HASH_D,
    toolchain: {
      cargo: "cargo 1.96.0",
      cargoStylus: "cargo-stylus 0.10.9",
      rustc: "rustc 1.96.0",
    },
    toolchainHash: HASH_E,
    version: VERIFICATION_VERSION,
  };
}

function agentModel(claimedStatus: "passed" | "failed") {
  return new ScriptedModel([
    response({
      arguments: "{}",
      callId: "verify-1",
      name: "run_release_verification",
      status: "completed",
      type: "function_call",
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "The fixed verification plan completed.",
            toolStatus: claimedStatus,
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

describe("Verification Agent processor", () => {
  it("renews the lease and records the deterministic pass", async () => {
    const verifications = { record: vi.fn(async () => ({ id: "1" })) };
    const leases = {
      claimNext: vi.fn(async () => lease()),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => lease()),
    };
    const verificationRunner = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return evidence("passed");
    });

    await expect(
      processOneVerification({
        heartbeatIntervalMs: 5,
        leaseSeconds: 60,
        leases: leases as Pick<
          LeaseRepository,
          "claimNext" | "defer" | "renew"
        >,
        model: agentModel("failed"),
        nowUnixSeconds: () => 1_800_000_000,
        retrySeconds: 300,
        verificationRunner,
        verifications: verifications as unknown as Pick<
          VerificationRepository,
          "record"
        >,
        workerId: "verify-worker",
      }),
    ).resolves.toMatchObject({ outcome: "passed", status: "processed" });
    expect(leases.renew).toHaveBeenCalled();
    expect(verifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ event: "verification_passed" }),
        evidence: expect.objectContaining({ status: "passed" }),
      }),
    );
    expect(leases.defer).not.toHaveBeenCalled();
  });

  it("records a deterministic verification failure", async () => {
    const verifications = { record: vi.fn(async () => ({ id: "1" })) };
    const leases = {
      claimNext: vi.fn(async () => lease()),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => lease()),
    };

    await expect(
      processOneVerification({
        leaseSeconds: 60,
        leases: leases as Pick<
          LeaseRepository,
          "claimNext" | "defer" | "renew"
        >,
        model: agentModel("passed"),
        retrySeconds: 300,
        verificationRunner: vi.fn(async () => evidence("failed")),
        verifications: verifications as unknown as Pick<
          VerificationRepository,
          "record"
        >,
        workerId: "verify-worker",
      }),
    ).resolves.toMatchObject({ outcome: "failed", status: "processed" });
    expect(verifications.record).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ event: "verification_failed" }),
      }),
    );
  });

  it("defers provider failure without running or recording verification", async () => {
    const verificationRunner = vi.fn();
    const verifications = { record: vi.fn() };
    const leases = {
      claimNext: vi.fn(async () => lease()),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => lease()),
    };

    await expect(
      processOneVerification({
        leaseSeconds: 60,
        leases: leases as Pick<
          LeaseRepository,
          "claimNext" | "defer" | "renew"
        >,
        model: new ScriptedModel([
          modelError(new Error("private provider detail"), {
            suggested: false,
          }),
        ]),
        retrySeconds: 300,
        verificationRunner,
        verifications: verifications as unknown as Pick<
          VerificationRepository,
          "record"
        >,
        workerId: "verify-worker",
      }),
    ).resolves.toMatchObject({
      code: "model_unavailable",
      status: "deferred",
    });
    expect(verificationRunner).not.toHaveBeenCalled();
    expect(verifications.record).not.toHaveBeenCalled();
  });

  it("stays idle when no built release is ready", async () => {
    const leases = {
      claimNext: vi.fn(async () => null),
      defer: vi.fn(),
      renew: vi.fn(),
    };

    await expect(
      processOneVerification({
        leaseSeconds: 60,
        leases: leases as Pick<
          LeaseRepository,
          "claimNext" | "defer" | "renew"
        >,
        model: new ScriptedModel(),
        retrySeconds: 300,
        verifications: { record: vi.fn() },
        workerId: "verify-worker",
      }),
    ).resolves.toEqual({ status: "idle" });
  });
});
