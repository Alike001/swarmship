export const PRODUCT = {
  name: "SwarmShip",
  network: "Arbitrum Sepolia",
  networkChainId: 421_614,
  tagline: "Multi-agent smart contract releases you can prove.",
} as const;

export const RELEASE_STATES = [
  "created",
  "needs_input",
  "specified",
  "building",
  "verification_failed",
  "awaiting_approval",
  "approved",
  "anchoring_manifest",
  "approved_not_deployed",
  "deploying",
  "deployed_unverified",
  "anchoring_receipt",
  "verified",
  "failed",
  "reconciliation_required",
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];
