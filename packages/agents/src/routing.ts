import { RELEASE_STATES } from "@swarmship/domain";
import { RECONCILIATION_KINDS } from "@swarmship/domain/release";
import { z } from "zod";

import type { AgentRole } from "./agents.js";
import { AgentRuntimeError } from "./runtime-error.js";

const snapshotSchema = z.strictObject({
  state: z.enum(RELEASE_STATES),
  version: z.number().int().nonnegative(),
  reconciliation: z.enum(RECONCILIATION_KINDS).nullable(),
});

export function selectRunnableAgent(snapshotInput: unknown): AgentRole {
  const parsed = snapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) {
    throw new AgentRuntimeError(
      "invalid_snapshot",
      "The stored release state is inconsistent and needs repair.",
    );
  }
  const snapshot = parsed.data;

  if (snapshot.state === "created" || snapshot.state === "needs_input")
    return "specification";
  if (
    snapshot.state === "specified" ||
    snapshot.state === "verification_failed"
  )
    return "build";
  if (snapshot.state === "building") return "verification";
  if (
    snapshot.state === "approved" ||
    snapshot.state === "approved_not_deployed" ||
    snapshot.state === "anchoring_manifest" ||
    snapshot.state === "deploying"
  )
    return "deployment";
  if (
    snapshot.state === "deployed_unverified" ||
    snapshot.state === "anchoring_receipt"
  )
    return "witness";
  if (snapshot.state === "reconciliation_required") {
    if (snapshot.reconciliation === "receipt_anchor") return "witness";
    if (
      snapshot.reconciliation === "manifest_anchor" ||
      snapshot.reconciliation === "deployment"
    )
      return "deployment";
    throw new AgentRuntimeError(
      "invalid_snapshot",
      "The release is missing its reconciliation operation.",
    );
  }
  if (snapshot.state === "awaiting_approval") {
    throw new AgentRuntimeError(
      "wait_for_user",
      "The exact release manifest is waiting for the user's signature.",
    );
  }
  throw new AgentRuntimeError(
    "terminal_state",
    "This release has already reached a final state.",
  );
}
