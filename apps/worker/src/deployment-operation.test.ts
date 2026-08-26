import type {
  DeploymentAttempt,
  StylusDeploymentResult,
} from "@swarmship/deployer";
import type { ReleaseLease } from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  runDeploymentOperation,
  type DeploymentOperationDependencies,
} from "./deployment-operation.js";

const DIGEST = `0x${"a".repeat(64)}` as const;
const ARTIFACT = `0x${"b".repeat(64)}` as const;
const TRANSACTION = `0x${"c".repeat(64)}` as const;
const RELAYER = "0x0000000000000000000000000000000000000004" as const;
const CONTRACT = "0x0000000000000000000000000000000000000005" as const;
const SPECIFICATION = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function attempt(status: DeploymentAttempt["status"]): DeploymentAttempt {
  return {
    approvalDigest: DIGEST,
    artifactHash: ARTIFACT,
    constructor: {
      expiry: SPECIFICATION.expiry,
      maxHandoffs: SPECIFICATION.maxHandoffs,
      owner: SPECIFICATION.owner,
      permittedReceiver: SPECIFICATION.permittedReceiver,
      permittedSender: SPECIFICATION.permittedSender,
    },
    contractAddress:
      status === "observed" || status === "confirmed" ? CONTRACT : null,
    nonce: 8,
    sender: RELAYER,
    startBlock: "100",
    status,
    transactionHash:
      status === "observed" || status === "confirmed" ? TRANSACTION : null,
    verificationStatus: status === "confirmed" ? "passed" : "pending",
    version: 1,
  };
}

function lease(
  state: ReleaseLease["release"]["state"],
  deploymentAttempt: DeploymentAttempt | null,
  reconciliationKind: ReleaseLease["release"]["reconciliationKind"] = null,
): ReleaseLease {
  return {
    token: "00000000-0000-4000-8000-000000000001",
    release: {
      deploymentAttempt,
      id: "00000000-0000-4000-8000-000000000002",
      reconciliationKind,
      specification: SPECIFICATION,
      state,
      version: 6,
    } as unknown as ReleaseLease["release"],
  };
}

function dependencies(
  releaseLease = lease("approved_not_deployed", null),
): DeploymentOperationDependencies {
  const observed = attempt("observed");
  return {
    confirm: vi.fn(async () => ({
      status: "confirmed" as const,
      blockNumber: 101n,
      inspection: {
        activatedVersion: 1,
        address: CONTRACT,
        bytecode: "0x6001" as const,
        configuration: {
          expiry: SPECIFICATION.expiry,
          maxHandoffs: SPECIFICATION.maxHandoffs,
          owner: SPECIFICATION.owner,
          permittedReceiver: SPECIFICATION.permittedReceiver,
          permittedSender: SPECIFICATION.permittedSender,
        },
        handoffCount: 0n,
      },
      transactionHash: TRANSACTION,
    })),
    deploy: vi.fn(async (): Promise<StylusDeploymentResult> => ({
      status: "observed",
      contractAddress: CONTRACT,
      transactionHash: TRANSACTION,
    })),
    deployments: {
      getAuthorizedDigest: vi.fn(async () => DIGEST),
      markObserved: vi.fn(async () => observed),
      markReconciledObserved: vi.fn(async () => observed),
      markRunning: vi.fn(async () => attempt("running")),
      markVerified: vi.fn(async () => attempt("confirmed")),
    },
    lease: releaseLease,
    nowUnixSeconds: 1_800_000_000,
    prepareArtifact: vi.fn(async () => ARTIFACT),
    prepareChain: vi.fn(async () => ({
      nonce: 8,
      sender: RELAYER,
      startBlock: 100n,
    })),
    reconcile: vi.fn(),
    verify: vi.fn(async () => ({ status: "passed" as const })),
    validateChain: vi.fn(async () => true),
    workerId: "deployment-worker",
  };
}

describe("guarded Stylus deployment operation", () => {
  it("prepares exact evidence and chain identifiers without deploying", async () => {
    const input = dependencies();
    const result = await runDeploymentOperation(input);

    expect(result).toMatchObject({
      preparedAttempt: {
        approvalDigest: DIGEST,
        artifactHash: ARTIFACT,
        nonce: 8,
        startBlock: "100",
        status: "prepared",
      },
      toolResult: { event: "deployment_started", evidenceRef: DIGEST },
    });
    expect(input.deploy).not.toHaveBeenCalled();
  });

  it("persists running and observed states before confirming success", async () => {
    const input = dependencies(lease("deploying", attempt("prepared")));
    const result = await runDeploymentOperation(input);

    expect(result.toolResult).toEqual({
      status: "accepted",
      event: "deployment_observed",
      evidenceRef: DIGEST,
    });
    expect(input.deployments.markRunning).toHaveBeenCalledOnce();
    expect(input.deployments.markObserved).toHaveBeenCalledWith(
      input.lease.release.id,
      "deployment-worker",
      input.lease.token,
      TRANSACTION,
      CONTRACT,
      1_800_000_000,
    );
    expect(input.deployments.markVerified).toHaveBeenCalledOnce();
  });

  it("returns for re-preparation when the relayer nonce changed", async () => {
    const input = dependencies(lease("deploying", attempt("prepared")));
    input.validateChain = vi.fn(async () => false);

    await expect(runDeploymentOperation(input)).resolves.toMatchObject({
      toolResult: { event: "deployment_reverted", status: "accepted" },
    });
    expect(input.deployments.markRunning).not.toHaveBeenCalled();
    expect(input.deploy).not.toHaveBeenCalled();
  });

  it("never blindly reruns an interrupted command", async () => {
    const input = dependencies(lease("deploying", attempt("running")));

    await expect(runDeploymentOperation(input)).resolves.toMatchObject({
      toolResult: { event: "deployment_unknown", status: "unknown" },
    });
    expect(input.deploy).not.toHaveBeenCalled();
    expect(input.confirm).not.toHaveBeenCalled();
  });

  it("reconciles an exact sender and nonce before verification", async () => {
    const input = dependencies(
      lease("reconciliation_required", attempt("unknown"), "deployment"),
    );
    input.reconcile = vi.fn(async () => ({
      status: "present" as const,
      contractAddress: CONTRACT,
      observedBlock: 102n,
      transactionHash: TRANSACTION,
    }));

    await expect(runDeploymentOperation(input)).resolves.toMatchObject({
      toolResult: { event: "deployment_reconciled_present" },
    });
    expect(input.deploy).not.toHaveBeenCalled();
    expect(input.deployments.markReconciledObserved).toHaveBeenCalledOnce();
    expect(input.verify).toHaveBeenCalledWith(TRANSACTION);
  });

  it("resumes verification after reconciled identifiers were already saved", async () => {
    const input = dependencies(
      lease("reconciliation_required", attempt("observed"), "deployment"),
    );

    await expect(runDeploymentOperation(input)).resolves.toMatchObject({
      toolResult: { event: "deployment_reconciled_present" },
    });
    expect(input.reconcile).not.toHaveBeenCalled();
    expect(input.deployments.markReconciledObserved).not.toHaveBeenCalled();
    expect(input.verify).toHaveBeenCalledWith(TRANSACTION);
  });

  it("rejects reconciled code that does not reproduce from approved source", async () => {
    const input = dependencies(
      lease("reconciliation_required", attempt("observed"), "deployment"),
    );
    input.verify = vi.fn(async () => ({
      reason: "artifact_mismatch" as const,
      status: "failed" as const,
    }));

    await expect(runDeploymentOperation(input)).resolves.toMatchObject({
      toolResult: {
        event: "deployment_verification_rejected",
        status: "accepted",
      },
    });
    expect(input.deployments.markVerified).not.toHaveBeenCalled();
  });
});
