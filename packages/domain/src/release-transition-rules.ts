import { RELEASE_STATES, type ReleaseState } from "./product.js";

export const RELEASE_ACTORS = [
  "specification",
  "build",
  "verification",
  "deployment",
  "witness",
  "user",
  "system",
] as const;

export type ReleaseActor = (typeof RELEASE_ACTORS)[number];

export const RECONCILIATION_KINDS = [
  "manifest_anchor",
  "deployment",
  "receipt_anchor",
] as const;

export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

export const RELEASE_TRANSITION_EFFECTS = [
  "invalidate_build_evidence",
  "invalidate_manifest_approval",
] as const;

export type ReleaseTransitionEffect =
  (typeof RELEASE_TRANSITION_EFFECTS)[number];

type TransitionRule = {
  actor: ReleaseActor;
  from: readonly ReleaseState[];
  to: ReleaseState;
  reconciliation?: ReconciliationKind;
  requiresReconciliation?: ReconciliationKind;
  effects?: readonly ReleaseTransitionEffect[];
};

const NON_TERMINAL_STATES = RELEASE_STATES.filter(
  (state) => state !== "verified" && state !== "failed",
);

export const RELEASE_TRANSITION_RULES = {
  specification_needs_input: {
    actor: "specification",
    from: ["created", "needs_input"],
    to: "needs_input",
  },
  specification_accepted: {
    actor: "specification",
    from: ["created", "needs_input"],
    to: "specified",
  },
  build_started: {
    actor: "build",
    from: ["specified", "verification_failed"],
    to: "building",
  },
  verification_failed: {
    actor: "verification",
    from: ["building"],
    to: "verification_failed",
  },
  verification_passed: {
    actor: "verification",
    from: ["building"],
    to: "awaiting_approval",
  },
  release_amended: {
    actor: "user",
    from: ["awaiting_approval", "approved", "approved_not_deployed"],
    to: "specified",
    effects: ["invalidate_build_evidence", "invalidate_manifest_approval"],
  },
  approval_granted: {
    actor: "user",
    from: ["awaiting_approval"],
    to: "approved",
  },
  manifest_anchor_started: {
    actor: "deployment",
    from: ["approved"],
    to: "anchoring_manifest",
  },
  manifest_anchor_confirmed: {
    actor: "deployment",
    from: ["anchoring_manifest"],
    to: "approved_not_deployed",
  },
  manifest_anchor_reverted: {
    actor: "deployment",
    from: ["anchoring_manifest"],
    to: "approved",
  },
  manifest_anchor_unknown: {
    actor: "deployment",
    from: ["anchoring_manifest"],
    to: "reconciliation_required",
    reconciliation: "manifest_anchor",
  },
  deployment_started: {
    actor: "deployment",
    from: ["approved_not_deployed"],
    to: "deploying",
  },
  deployment_observed: {
    actor: "deployment",
    from: ["deploying"],
    to: "deployed_unverified",
  },
  deployment_reverted: {
    actor: "deployment",
    from: ["deploying"],
    to: "approved_not_deployed",
  },
  deployment_unknown: {
    actor: "deployment",
    from: ["deploying"],
    to: "reconciliation_required",
    reconciliation: "deployment",
  },
  witness_confirmed: {
    actor: "witness",
    from: ["deployed_unverified"],
    to: "anchoring_receipt",
  },
  receipt_anchor_confirmed: {
    actor: "witness",
    from: ["anchoring_receipt"],
    to: "verified",
  },
  receipt_anchor_reverted: {
    actor: "witness",
    from: ["anchoring_receipt"],
    to: "deployed_unverified",
  },
  receipt_anchor_unknown: {
    actor: "witness",
    from: ["anchoring_receipt"],
    to: "reconciliation_required",
    reconciliation: "receipt_anchor",
  },
  manifest_anchor_reconciled_missing: {
    actor: "deployment",
    from: ["reconciliation_required"],
    to: "approved",
    requiresReconciliation: "manifest_anchor",
  },
  manifest_anchor_reconciled_present: {
    actor: "deployment",
    from: ["reconciliation_required"],
    to: "approved_not_deployed",
    requiresReconciliation: "manifest_anchor",
  },
  deployment_reconciled_missing: {
    actor: "deployment",
    from: ["reconciliation_required"],
    to: "approved_not_deployed",
    requiresReconciliation: "deployment",
  },
  deployment_reconciled_present: {
    actor: "deployment",
    from: ["reconciliation_required"],
    to: "deployed_unverified",
    requiresReconciliation: "deployment",
  },
  deployment_verification_rejected: {
    actor: "deployment",
    from: ["reconciliation_required"],
    to: "approved_not_deployed",
    requiresReconciliation: "deployment",
  },
  receipt_anchor_reconciled_missing: {
    actor: "witness",
    from: ["reconciliation_required"],
    to: "deployed_unverified",
    requiresReconciliation: "receipt_anchor",
  },
  receipt_anchor_reconciled_present: {
    actor: "witness",
    from: ["reconciliation_required"],
    to: "verified",
    requiresReconciliation: "receipt_anchor",
  },
  system_failed: {
    actor: "system",
    from: NON_TERMINAL_STATES,
    to: "failed",
  },
} as const satisfies Record<string, TransitionRule>;

export type ReleaseEvent = keyof typeof RELEASE_TRANSITION_RULES;
export const RELEASE_EVENTS = Object.keys(
  RELEASE_TRANSITION_RULES,
) as ReleaseEvent[];
