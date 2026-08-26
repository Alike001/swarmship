import { Usage, type ModelResponse } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import type {
  LeaseRepository,
  ReceiptAnchorRepository,
  ReleaseLease,
} from "@swarmship/persistence";
import { PersistenceError } from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  processOneWitness,
  type WitnessProcessorDependencies,
} from "./witness-processor.js";

const MANIFEST = `0x${"a".repeat(64)}` as const;
const DEPLOYMENT_TX = `0x${"b".repeat(64)}` as const;
const ARTIFACT = `0x${"c".repeat(64)}` as const;
const CODE_HASH = `0x${"d".repeat(64)}` as const;
const RELEASE_ID = `0x${"e".repeat(64)}` as const;
const OWNER = "0x0000000000000000000000000000000000000001" as const;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;
const RELAYER = "0x0000000000000000000000000000000000000004" as const;
const CONTRACT = "0x0000000000000000000000000000000000000005" as const;
const SPECIFICATION = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: OWNER,
  permittedSender: SENDER,
  permittedReceiver: RECEIVER,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function response(...output: ModelResponse["output"]): ModelResponse {
  return { output, usage: new Usage() };
}

function model(): ScriptedModel {
  return new ScriptedModel([
    response({
      arguments: "{}",
      callId: "witness-1",
      name: "read_independent_evidence",
      status: "completed",
      type: "function_call",
    }),
    response({
      content: [
        {
          text: JSON.stringify({
            summary: "Independent evidence matched the exact deployment.",
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
      state: "deployed_unverified",
      version: 7,
      reconciliationKind: null,
      specification: SPECIFICATION,
      manifestApproval: {
        digest: MANIFEST,
        manifest: { releaseId: RELEASE_ID },
      },
      deploymentAttempt: {
        artifactHash: ARTIFACT,
        contractAddress: CONTRACT,
        nonce: 7,
        sender: RELAYER,
        status: "confirmed",
        transactionHash: DEPLOYMENT_TX,
        verificationStatus: "passed",
      },
      receiptAnchorAttempt: null,
      receiptEvidence: null,
    } as unknown as ReleaseLease["release"],
  };
}

function stores(claim: ReleaseLease | null = lease()) {
  return {
    leases: {
      claimNext: vi.fn(async () => claim),
      defer: vi.fn(async () => undefined),
      renew: vi.fn(async () => claim ?? lease()),
    } as unknown as Pick<LeaseRepository, "claimNext" | "defer" | "renew">,
    receipts: {
      markBroadcasting: vi.fn(),
      markSubmitted: vi.fn(),
      recordOutcome: vi.fn(),
      recordPrepared: vi.fn(async () => ({ id: "transition" })),
      recordRejected: vi.fn(),
    } as unknown as Pick<
      ReceiptAnchorRepository,
      | "markBroadcasting"
      | "markSubmitted"
      | "recordOutcome"
      | "recordPrepared"
      | "recordRejected"
    >,
  };
}

function processorInput(input = stores()): WitnessProcessorDependencies {
  return {
    ...input,
    broadcast: vi.fn(),
    confirm: vi.fn(),
    inspectOfficial: vi.fn(async () => ({
      address: CONTRACT,
      bytecode: "0x6001" as const,
      chainId: 421614,
    })),
    inspectWitness: vi.fn(async () => ({
      address: CONTRACT,
      bytecode: "0x6001" as const,
      chainId: 421614,
    })),
    leaseSeconds: 60,
    model: model(),
    nowUnixSeconds: () => 1_800_000_000,
    observeDeployment: vi.fn(async () => ({
      status: "confirmed" as const,
      chainId: 421614,
      blockNumber: 120n,
      codeHash: CODE_HASH,
      inspection: {
        activatedVersion: 1,
        address: CONTRACT,
        bytecode: "0x6001" as const,
        configuration: {
          owner: OWNER,
          permittedSender: SENDER,
          permittedReceiver: RECEIVER,
          maxHandoffs: 5,
          expiry: 2_000_000_000,
        },
        handoffCount: 0n,
      },
      nonce: 7,
      sender: RELAYER,
      transactionHash: DEPLOYMENT_TX,
    })),
    prepare: vi.fn(async (proofRoot: string) => ({
      kind: "ready" as const,
      nonce: 8,
      proofRoot: proofRoot as `0x${string}`,
      sender: RELAYER,
      startBlock: 100n,
    })),
    reconcileOfficial: vi.fn(),
    reconcileWitness: vi.fn(),
    retrySeconds: 300,
    verifyManifestWitness: vi.fn(async (proofRoot: string) => ({
      anchored: true,
      proofRoot: proofRoot as `0x${string}`,
      submitter: RELAYER,
      timestamp: 123n,
    })),
    verifyReceiptOfficial: vi.fn(),
    verifyReceiptWitness: vi.fn(),
    verifySource: vi.fn(async () => ({ status: "passed" as const })),
    workerId: "witness-worker",
  };
}

describe("Witness Agent processor", () => {
  it("claims only Witness states and persists canonical preparation", async () => {
    const input = processorInput();
    await expect(processOneWitness(input)).resolves.toMatchObject({
      event: "witness_confirmed",
      status: "processed",
    });
    expect(input.leases.claimNext).toHaveBeenCalledWith(
      "witness-worker",
      60,
      ["deployed_unverified", "anchoring_receipt", "reconciliation_required"],
      ["receipt_anchor"],
    );
    expect(input.receipts.recordPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ status: "prepared" }),
        command: expect.objectContaining({ event: "witness_confirmed" }),
        evidence: expect.objectContaining({
          officialChainId: 421614,
          witnessChainId: 421614,
        }),
      }),
    );
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("defers an unavailable independent RPC without persistence", async () => {
    const input = processorInput();
    input.observeDeployment = vi.fn(async () => ({
      status: "unknown" as const,
      reason: "rpc_unavailable" as const,
    }));
    await expect(processOneWitness(input)).resolves.toMatchObject({
      status: "deferred",
    });
    expect(input.receipts.recordPrepared).not.toHaveBeenCalled();
    expect(input.leases.defer).toHaveBeenCalledOnce();
  });

  it("discards output when the lease is lost before persistence", async () => {
    const input = processorInput();
    input.receipts.recordPrepared = vi.fn(async () => {
      throw new PersistenceError("lease_lost", "Lease lost.");
    });
    await expect(processOneWitness(input)).resolves.toEqual({
      releaseId: lease().release.id,
      status: "lease_lost",
    });
    expect(input.leases.defer).not.toHaveBeenCalled();
  });

  it("stays idle when no Witness work is available", async () => {
    const input = processorInput(stores(null));
    await expect(processOneWitness(input)).resolves.toEqual({ status: "idle" });
    expect(input.observeDeployment).not.toHaveBeenCalled();
  });
});
