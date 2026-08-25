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

const EVIDENCE = `0x${"c".repeat(64)}`;

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

describe("release transition guards", () => {
  it("rejects another role using a specification transition", () => {
    const result = applyReleaseTransition(
      { state: "created", version: 0, reconciliation: null },
      command("specification_accepted", "deployment", 0),
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "wrong_actor" },
    });
  });

  it("rejects a stale worker result", () => {
    const result = applyReleaseTransition(
      { state: "building", version: 7, reconciliation: null },
      command("verification_passed", "verification", 6),
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "stale_version" },
    });
  });

  it("requires a non-zero evidence reference", () => {
    const result = applyReleaseTransition(
      { state: "created", version: 0, reconciliation: null },
      {
        ...command("specification_accepted", "specification", 0),
        evidenceRef: `0x${"0".repeat(64)}`,
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "invalid_command", fields: [{ field: "evidenceRef" }] },
    });
  });

  it("stops a failed verification before approval or deployment", () => {
    const failed = advance(
      { state: "building", version: 2, reconciliation: null },
      "verification_failed",
    );
    const approval = applyReleaseTransition(
      failed,
      command("approval_granted", "user", failed.version),
    );
    const deployment = applyReleaseTransition(
      failed,
      command("deployment_started", "deployment", failed.version),
    );

    expect(approval).toMatchObject({
      success: false,
      error: { code: "invalid_transition" },
    });
    expect(deployment).toMatchObject({
      success: false,
      error: { code: "invalid_transition" },
    });
    expect(advance(failed, "build_started").state).toBe("building");
  });

  it("rejects a version that cannot be incremented safely", () => {
    const result = applyReleaseTransition(
      {
        state: "created",
        version: Number.MAX_SAFE_INTEGER,
        reconciliation: null,
      },
      command(
        "specification_accepted",
        "specification",
        Number.MAX_SAFE_INTEGER,
      ),
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "invalid_snapshot", fields: [{ field: "version" }] },
    });
  });

  it.each(["verified", "failed"] as const)(
    "does not mutate the terminal %s state",
    (state) => {
      const result = applyReleaseTransition(
        { state, version: 9, reconciliation: null },
        command("system_failed", "system", 9),
      );

      expect(result).toMatchObject({
        success: false,
        error: { code: "terminal_state" },
      });
    },
  );
});
