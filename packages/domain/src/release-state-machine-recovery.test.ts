import { describe, expect, it } from "vitest";

import {
  applyReleaseTransition,
  type ReleaseSnapshot,
} from "./release-state-machine.js";
import {
  type ReconciliationKind,
  type ReleaseActor,
  type ReleaseEvent,
} from "./release-transition-rules.js";

const EVIDENCE = `0x${"b".repeat(64)}`;

function run(
  snapshot: ReleaseSnapshot,
  event: ReleaseEvent,
  actor: ReleaseActor,
) {
  return applyReleaseTransition(snapshot, {
    event,
    actor,
    expectedVersion: snapshot.version,
    evidenceRef: EVIDENCE,
  });
}

describe("release state reconciliation", () => {
  it.each([
    ["anchoring_manifest", "manifest_anchor_unknown", "manifest_anchor"],
    ["deploying", "deployment_unknown", "deployment"],
    ["anchoring_receipt", "receipt_anchor_unknown", "receipt_anchor"],
  ] as const)(
    "preserves the unresolved %s operation",
    (state, event, reconciliation) => {
      const actor =
        reconciliation === "receipt_anchor" ? "witness" : "deployment";
      const result = run(
        { state, version: 3, reconciliation: null },
        event,
        actor,
      );

      expect(result).toMatchObject({
        success: true,
        snapshot: {
          state: "reconciliation_required",
          version: 4,
          reconciliation,
        },
      });
    },
  );

  it.each([
    [
      "manifest_anchor",
      "manifest_anchor_reconciled_missing",
      "deployment",
      "approved",
    ],
    [
      "manifest_anchor",
      "manifest_anchor_reconciled_present",
      "deployment",
      "approved_not_deployed",
    ],
    [
      "deployment",
      "deployment_reconciled_missing",
      "deployment",
      "approved_not_deployed",
    ],
    [
      "deployment",
      "deployment_reconciled_present",
      "deployment",
      "deployed_unverified",
    ],
    [
      "receipt_anchor",
      "receipt_anchor_reconciled_missing",
      "witness",
      "deployed_unverified",
    ],
    [
      "receipt_anchor",
      "receipt_anchor_reconciled_present",
      "witness",
      "verified",
    ],
  ] as const)(
    "resolves %s through %s to %s",
    (reconciliation, event, actor, state) => {
      const result = run(
        {
          state: "reconciliation_required",
          version: 12,
          reconciliation,
        },
        event,
        actor,
      );

      expect(result).toMatchObject({
        success: true,
        snapshot: { state, version: 13, reconciliation: null },
      });
    },
  );

  it("rejects recovery for a different unresolved operation", () => {
    const result = run(
      {
        state: "reconciliation_required",
        version: 5,
        reconciliation: "deployment",
      },
      "manifest_anchor_reconciled_present",
      "deployment",
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "reconciliation_mismatch" },
    });
  });

  it.each([
    [
      "anchoring_manifest",
      "manifest_anchor_reverted",
      "deployment",
      "approved",
    ],
    ["deploying", "deployment_reverted", "deployment", "approved_not_deployed"],
    [
      "anchoring_receipt",
      "receipt_anchor_reverted",
      "witness",
      "deployed_unverified",
    ],
  ] as const)(
    "returns a known reverted %s action to %s",
    (from, event, actor, to) => {
      const result = run(
        { state: from, version: 4, reconciliation: null },
        event,
        actor,
      );

      expect(result).toMatchObject({
        success: true,
        snapshot: { state: to, version: 5, reconciliation: null },
      });
    },
  );

  it("rejects an inconsistent stored reconciliation snapshot", () => {
    const result = run(
      {
        state: "reconciliation_required",
        version: 5,
        reconciliation: null as ReconciliationKind | null,
      },
      "deployment_reconciled_present",
      "deployment",
    );

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "invalid_snapshot",
        fields: [{ field: "reconciliation" }],
      },
    });
  });
});
