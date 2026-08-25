import { z } from "zod";

import { nonZeroBytes32Schema } from "./evm-primitives.js";
import { RELEASE_STATES, type ReleaseState } from "./product.js";
import {
  RECONCILIATION_KINDS,
  RELEASE_ACTORS,
  RELEASE_EVENTS,
  RELEASE_TRANSITION_RULES,
  type ReleaseActor,
  type ReleaseEvent,
  type ReleaseTransitionEffect,
} from "./release-transition-rules.js";
import { fieldErrors, type FieldValidationError } from "./validation.js";

const snapshotSchema = z
  .strictObject({
    state: z.enum(RELEASE_STATES),
    version: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    reconciliation: z.enum(RECONCILIATION_KINDS).nullable(),
  })
  .refine(
    (snapshot) =>
      (snapshot.state === "reconciliation_required") ===
      (snapshot.reconciliation !== null),
    {
      path: ["reconciliation"],
      message: "Reconciliation context must match the release state.",
    },
  );

const commandSchema = z.strictObject({
  actor: z.enum(RELEASE_ACTORS),
  event: z.enum(RELEASE_EVENTS as [ReleaseEvent, ...ReleaseEvent[]]),
  expectedVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  evidenceRef: nonZeroBytes32Schema,
});

export type ReleaseSnapshot = z.infer<typeof snapshotSchema>;
export type ReleaseTransitionCommand = z.infer<typeof commandSchema>;

export type ReleaseTransitionRecord = {
  actor: ReleaseActor;
  effects: ReleaseTransitionEffect[];
  event: ReleaseEvent;
  evidenceRef: `0x${string}`;
  from: ReleaseState;
  to: ReleaseState;
  versionBefore: number;
  versionAfter: number;
};

export type ReleaseTransitionErrorCode =
  | "invalid_snapshot"
  | "invalid_command"
  | "stale_version"
  | "terminal_state"
  | "wrong_actor"
  | "invalid_transition"
  | "reconciliation_mismatch";

export type ReleaseTransitionResult =
  | {
      success: true;
      snapshot: ReleaseSnapshot;
      record: ReleaseTransitionRecord;
    }
  | {
      success: false;
      error: {
        code: ReleaseTransitionErrorCode;
        message: string;
        fields?: FieldValidationError[];
      };
    };

function failure(
  code: ReleaseTransitionErrorCode,
  message: string,
  fields?: FieldValidationError[],
): ReleaseTransitionResult {
  return {
    success: false,
    error: fields === undefined ? { code, message } : { code, message, fields },
  };
}

export function applyReleaseTransition(
  snapshotInput: unknown,
  commandInput: unknown,
): ReleaseTransitionResult {
  const snapshotResult = snapshotSchema.safeParse(snapshotInput);
  if (!snapshotResult.success) {
    return failure(
      "invalid_snapshot",
      "The stored release state is inconsistent and needs repair.",
      fieldErrors(snapshotResult.error),
    );
  }

  const commandResult = commandSchema.safeParse(commandInput);
  if (!commandResult.success) {
    return failure(
      "invalid_command",
      "The requested release transition is incomplete or malformed.",
      fieldErrors(commandResult.error),
    );
  }

  const snapshot = snapshotResult.data;
  const command = commandResult.data;
  const rule = RELEASE_TRANSITION_RULES[command.event];

  if (command.expectedVersion !== snapshot.version) {
    return failure(
      "stale_version",
      "This release changed before the action completed. Reload its latest state.",
    );
  }
  if (snapshot.state === "verified" || snapshot.state === "failed") {
    return failure(
      "terminal_state",
      "This release has already reached a final state.",
    );
  }
  if (command.actor !== rule.actor) {
    return failure(
      "wrong_actor",
      `The ${command.actor} role cannot perform ${command.event}.`,
    );
  }
  if (!(rule.from as readonly ReleaseState[]).includes(snapshot.state)) {
    return failure(
      "invalid_transition",
      `${command.event} cannot run while the release is ${snapshot.state}.`,
    );
  }
  if (
    "requiresReconciliation" in rule &&
    snapshot.reconciliation !== rule.requiresReconciliation
  ) {
    return failure(
      "reconciliation_mismatch",
      "The recovery action does not match the unresolved chain operation.",
    );
  }

  const nextVersion = snapshot.version + 1;
  const nextSnapshot: ReleaseSnapshot = {
    state: rule.to,
    version: nextVersion,
    reconciliation: "reconciliation" in rule ? rule.reconciliation : null,
  };

  return {
    success: true,
    snapshot: nextSnapshot,
    record: {
      actor: command.actor,
      effects: "effects" in rule ? [...rule.effects] : [],
      event: command.event,
      evidenceRef: command.evidenceRef,
      from: snapshot.state,
      to: rule.to,
      versionBefore: snapshot.version,
      versionAfter: nextVersion,
    },
  };
}
