import { describe, expect, it } from "vitest";

import {
  ANCHOR_TX,
  DEPLOYMENT_TX,
  prepared,
  RECEIPT_ROOT,
  witnessDependencies,
} from "./witness-operation.fixture.js";
import { runWitnessOperation } from "./witness-operation.js";

describe("guarded Witness and receipt operation", () => {
  it("constructs the exact receipt and prepares without broadcasting", async () => {
    const input = witnessDependencies();
    const output = await runWitnessOperation(input);
    expect(output).toMatchObject({
      preparedAttempt: { proofRoot: RECEIPT_ROOT, status: "prepared" },
      preparedEvidence: { receiptRoot: RECEIPT_ROOT },
      toolResult: {
        event: "witness_confirmed",
        evidenceRef: RECEIPT_ROOT,
        status: "verified",
      },
    });
    expect(input.broadcast).not.toHaveBeenCalled();
    expect(input.verifySource).toHaveBeenCalledOnce();
  });

  it("records deterministic chain mismatch without preparing an anchor", async () => {
    const input = witnessDependencies();
    input.observeDeployment.mockResolvedValue({
      status: "mismatch",
      reason: "configuration_mismatch",
    });
    const output = await runWitnessOperation(input);
    expect(output.toolResult).toEqual({
      status: "mismatch",
      event: "witness_rejected",
      evidenceRef: DEPLOYMENT_TX,
    });
    expect(input.prepare).not.toHaveBeenCalled();
  });

  it("defers an unavailable witness RPC instead of calling it a mismatch", async () => {
    const input = witnessDependencies();
    input.observeDeployment.mockResolvedValue({
      status: "unknown",
      reason: "rpc_unavailable",
    });
    await expect(runWitnessOperation(input)).rejects.toThrow(
      "Independent deployment evidence is unavailable",
    );
    expect(input.prepare).not.toHaveBeenCalled();
  });

  it("defers source tool failures instead of recording false mismatches", async () => {
    const input = witnessDependencies();
    input.verifySource.mockResolvedValue({
      status: "failed",
      reason: "command_timed_out",
    });
    await expect(runWitnessOperation(input)).rejects.toThrow(
      "Independent source verification is unavailable",
    );
    expect(input.prepare).not.toHaveBeenCalled();
  });

  it("persists intent and transaction hash before confirming both RPC views", async () => {
    const input = witnessDependencies({
      attempt: prepared(),
      state: "anchoring_receipt",
    });
    const output = await runWitnessOperation(input);
    expect(input.calls).toEqual([
      "persist-broadcasting",
      "broadcast",
      "persist-submitted",
    ]);
    expect(output.toolResult.event).toBe("receipt_anchor_confirmed");
    expect(input.verifyReceiptWitness).toHaveBeenCalledWith(RECEIPT_ROOT);
  });

  it.each([
    ["reverted", "receipt_anchor_reverted", "mismatch"],
    ["unknown", "receipt_anchor_unknown", "unknown"],
  ] as const)(
    "maps a %s receipt without rebroadcasting",
    async (status, event, toolStatus) => {
      const input = witnessDependencies({
        attempt: prepared("submitted"),
        state: "anchoring_receipt",
      });
      input.confirm.mockResolvedValue(
        status === "reverted"
          ? { blockNumber: 130n, status, transactionHash: ANCHOR_TX }
          : {
              reason: "receipt_unavailable",
              status,
              transactionHash: ANCHOR_TX,
            },
      );
      const output = await runWitnessOperation(input);
      expect(output.toolResult).toMatchObject({ event, status: toolStatus });
      expect(input.broadcast).not.toHaveBeenCalled();
    },
  );

  it("never rebroadcasts an attempt left in broadcasting state", async () => {
    const input = witnessDependencies({
      attempt: prepared("broadcasting"),
      state: "anchoring_receipt",
    });
    const output = await runWitnessOperation(input);
    expect(output.toolResult.event).toBe("receipt_anchor_unknown");
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("requires matching reconciliation from both RPC providers", async () => {
    const input = witnessDependencies({
      attempt: prepared("unknown"),
      state: "reconciliation_required",
    });
    input.reconcileWitness.mockResolvedValue({
      observedBlock: 130n,
      status: "missing",
    });
    await expect(runWitnessOperation(input)).rejects.toThrow(
      "outcome is still inconclusive",
    );
  });
});
