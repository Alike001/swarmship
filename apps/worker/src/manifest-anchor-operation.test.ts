import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  HeroAnchorReconciliation,
  HeroProofRecord,
} from "@swarmship/chain";
import type {
  ManifestAnchorAttempt,
  ReleaseLease,
} from "@swarmship/persistence";
import { describe, expect, it, vi } from "vitest";

import { runManifestAnchorOperation } from "./manifest-anchor-operation.js";

const ROOT = `0x${"a".repeat(64)}` as const;
const TX = `0x${"b".repeat(64)}` as const;
const SENDER = "0x0000000000000000000000000000000000000001" as const;

function prepared(
  status: Extract<
    ManifestAnchorAttempt,
    { kind: "prepared" }
  >["status"] = "prepared",
): Extract<ManifestAnchorAttempt, { kind: "prepared" }> {
  return {
    kind: "prepared",
    nonce: 7,
    proofRoot: ROOT,
    sender: SENDER,
    startBlock: "100",
    status,
    transactionHash: status === "submitted" ? TX : null,
    version: 1,
  };
}

function lease(
  state: "approved" | "anchoring_manifest" | "reconciliation_required",
  attempt: ManifestAnchorAttempt | null = null,
): ReleaseLease {
  return {
    token: "00000000-0000-4000-8000-000000000001",
    release: {
      id: "00000000-0000-4000-8000-000000000002",
      manifestAnchorAttempt: attempt,
      reconciliationKind:
        state === "reconciliation_required" ? "manifest_anchor" : null,
      state,
      version: 5,
    } as ReleaseLease["release"],
  };
}

function proof(anchored = true): HeroProofRecord {
  return { anchored, proofRoot: ROOT, submitter: SENDER, timestamp: 123n };
}

function dependencies(
  input: {
    attempt?: ManifestAnchorAttempt | null;
    state?: "approved" | "anchoring_manifest" | "reconciliation_required";
  } = {},
) {
  const calls: string[] = [];
  const anchors = {
    getAuthorizedRoot: vi.fn(async () => ROOT),
    markBroadcasting: vi.fn(async () => {
      calls.push("persist-broadcasting");
      return prepared("broadcasting");
    }),
    markSubmitted: vi.fn(async () => {
      calls.push("persist-submitted");
      return prepared("submitted");
    }),
  };
  const broadcast = vi.fn(async (): Promise<HeroAnchorBroadcast> => {
    calls.push("broadcast");
    return { kind: "submitted", transactionHash: TX };
  });
  return {
    anchors,
    broadcast,
    calls,
    confirm: vi.fn(async (): Promise<HeroAnchorConfirmation> => ({
      blockNumber: 120n,
      logIndex: 0,
      proof: proof(),
      status: "confirmed",
      transactionHash: TX,
    })),
    lease: lease(input.state ?? "approved", input.attempt ?? null),
    nowUnixSeconds: 1_800_000_000,
    prepare: vi.fn(async (): Promise<HeroAnchorPreparation> => ({
      kind: "ready",
      nonce: 7,
      proofRoot: ROOT,
      sender: SENDER,
      startBlock: 100n,
    })),
    reconcile: vi.fn(async (): Promise<HeroAnchorReconciliation> => ({
      observedBlock: 120n,
      proof: proof(),
      status: "present",
    })),
    verify: vi.fn(async () => proof()),
    workerId: "manifest-worker",
  };
}

describe("guarded HERŌ manifest anchor operation", () => {
  it("prepares the approved digest without broadcasting", async () => {
    const input = dependencies();
    const output = await runManifestAnchorOperation(input);

    expect(output).toMatchObject({
      preparedAttempt: { proofRoot: ROOT, status: "prepared" },
      toolResult: { event: "manifest_anchor_started", evidenceRef: ROOT },
    });
    expect(input.prepare).toHaveBeenCalledWith(ROOT);
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("records an existing HERŌ proof without spending gas", async () => {
    const input = dependencies();
    input.prepare.mockResolvedValue({
      kind: "already_anchored",
      proof: proof(),
    });

    const output = await runManifestAnchorOperation(input);

    expect(output).toMatchObject({
      preparedAttempt: { kind: "existing", proofRoot: ROOT },
      toolResult: { event: "manifest_anchor_started" },
    });
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("persists intent before broadcasting and the hash before confirming", async () => {
    const input = dependencies({
      attempt: prepared(),
      state: "anchoring_manifest",
    });
    const output = await runManifestAnchorOperation(input);

    expect(input.calls).toEqual([
      "persist-broadcasting",
      "broadcast",
      "persist-submitted",
    ]);
    expect(output.toolResult.event).toBe("manifest_anchor_confirmed");
    expect(input.confirm).toHaveBeenCalledWith(ROOT, TX);
  });

  it("never rebroadcasts an attempt left in broadcasting state", async () => {
    const input = dependencies({
      attempt: prepared("broadcasting"),
      state: "anchoring_manifest",
    });
    const output = await runManifestAnchorOperation(input);

    expect(output.toolResult).toMatchObject({
      event: "manifest_anchor_unknown",
      status: "unknown",
    });
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("marks a failed broadcast as unknown after saving intent", async () => {
    const input = dependencies({
      attempt: prepared(),
      state: "anchoring_manifest",
    });
    input.broadcast.mockRejectedValue(new Error("private RPC response"));

    const output = await runManifestAnchorOperation(input);

    expect(input.calls).toEqual(["persist-broadcasting"]);
    expect(output.toolResult).toMatchObject({
      event: "manifest_anchor_unknown",
      status: "unknown",
    });
  });

  it("confirms a submitted transaction without sending another", async () => {
    const input = dependencies({
      attempt: prepared("submitted"),
      state: "anchoring_manifest",
    });
    const output = await runManifestAnchorOperation(input);

    expect(output.toolResult.event).toBe("manifest_anchor_confirmed");
    expect(input.confirm).toHaveBeenCalledWith(ROOT, TX);
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it.each([
    ["reverted", "manifest_anchor_reverted", "accepted"],
    ["unknown", "manifest_anchor_unknown", "unknown"],
  ] as const)(
    "maps a %s receipt without rebroadcasting",
    async (status, event, toolStatus) => {
      const input = dependencies({
        attempt: prepared("submitted"),
        state: "anchoring_manifest",
      });
      input.confirm.mockResolvedValue(
        status === "reverted"
          ? { blockNumber: 120n, status, transactionHash: TX }
          : { reason: "receipt_unavailable", status, transactionHash: TX },
      );

      const output = await runManifestAnchorOperation(input);

      expect(output.toolResult).toMatchObject({ event, status: toolStatus });
      expect(input.broadcast).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["present", "manifest_anchor_reconciled_present"],
    ["missing", "manifest_anchor_reconciled_missing"],
  ] as const)(
    "maps %s reconciliation deterministically",
    async (status, event) => {
      const input = dependencies({
        attempt: prepared("unknown"),
        state: "reconciliation_required",
      });
      input.reconcile.mockResolvedValue(
        status === "present"
          ? { observedBlock: 120n, proof: proof(), status }
          : { observedBlock: 120n, status },
      );

      const output = await runManifestAnchorOperation(input);

      expect(output.toolResult.event).toBe(event);
      expect(input.reconcile).toHaveBeenCalledWith({
        proofRoot: ROOT,
        requiredObservationBlock: 102n,
        startBlock: 100n,
      });
    },
  );
});
