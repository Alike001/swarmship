import { describe, expect, it } from "vitest";

import {
  applyReleaseTransition,
  type ReleaseSnapshot,
} from "./release-state-machine.js";
import {
  RELEASE_TRANSITION_RULES,
  type ReleaseActor,
  type ReleaseEvent,
} from "./release-transition-rules.js";

const EVIDENCE = `0x${"a".repeat(64)}`;

function command(
  event: ReleaseEvent,
  actor: ReleaseActor,
  expectedVersion: number,
) {
  return { event, actor, expectedVersion, evidenceRef: EVIDENCE };
}

function advance(
  snapshot: ReleaseSnapshot,
  event: ReleaseEvent,
): ReleaseSnapshot {
  const rule = RELEASE_TRANSITION_RULES[event];
  const result = applyReleaseTransition(
    snapshot,
    command(event, rule.actor, snapshot.version),
  );
  if (!result.success) throw new Error(result.error.message);
  return result.snapshot;
}

describe("release state machine", () => {
  it("has an executable path for every declared event", () => {
    const rules = Object.entries(RELEASE_TRANSITION_RULES) as Array<
      [ReleaseEvent, (typeof RELEASE_TRANSITION_RULES)[ReleaseEvent]]
    >;

    for (const [event, rule] of rules) {
      const snapshot: ReleaseSnapshot = {
        state: rule.from[0],
        version: 2,
        reconciliation:
          "requiresReconciliation" in rule ? rule.requiresReconciliation : null,
      };
      const result = applyReleaseTransition(
        snapshot,
        command(event, rule.actor, snapshot.version),
      );

      expect(result, event).toMatchObject({ success: true });
    }
  });

  it("completes the proven v1 path in fixed role order", () => {
    let snapshot: ReleaseSnapshot = {
      state: "created",
      version: 0,
      reconciliation: null,
    };

    for (const event of [
      "specification_accepted",
      "build_started",
      "verification_passed",
      "approval_granted",
      "manifest_anchor_started",
      "manifest_anchor_confirmed",
      "deployment_started",
      "deployment_observed",
      "witness_confirmed",
      "receipt_anchor_confirmed",
    ] as const) {
      snapshot = advance(snapshot, event);
    }

    expect(snapshot).toEqual({
      state: "verified",
      version: 10,
      reconciliation: null,
    });
  });

  it("records actor, event, evidence, states, and versions", () => {
    const result = applyReleaseTransition(
      { state: "created", version: 4, reconciliation: null },
      command("specification_accepted", "specification", 4),
    );

    expect(result).toEqual({
      success: true,
      snapshot: { state: "specified", version: 5, reconciliation: null },
      record: {
        actor: "specification",
        effects: [],
        event: "specification_accepted",
        evidenceRef: EVIDENCE,
        from: "created",
        to: "specified",
        versionBefore: 4,
        versionAfter: 5,
      },
    });
  });

  it("invalidates approval progress after a material user amendment", () => {
    const result = applyReleaseTransition(
      { state: "approved_not_deployed", version: 8, reconciliation: null },
      command("release_amended", "user", 8),
    );

    expect(result).toMatchObject({
      success: true,
      snapshot: { state: "specified", version: 9, reconciliation: null },
      record: {
        effects: ["invalidate_build_evidence", "invalidate_manifest_approval"],
      },
    });
  });
});
