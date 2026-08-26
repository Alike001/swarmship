import {
  deploymentAttemptSchema,
  type DeploymentAttempt,
} from "@swarmship/deployer";

import type { Database } from "./database.js";
import { PersistenceError } from "./errors.js";
import { validateApprovedRelease } from "./release-guard.js";
import type { ReleaseRow } from "./types.js";

export function deploymentMatchesRelease(
  attempt: DeploymentAttempt,
  current: ReleaseRow,
): boolean {
  const spec = current.specification;
  const verification = current.verificationEvidence;
  return (
    spec !== null &&
    verification?.status === "passed" &&
    verification.artifactHash !== null &&
    current.manifestApproval?.digest === attempt.approvalDigest &&
    attempt.artifactHash === verification.artifactHash &&
    JSON.stringify(attempt.constructor) ===
      JSON.stringify({
        expiry: spec.expiry,
        maxHandoffs: spec.maxHandoffs,
        owner: spec.owner,
        permittedReceiver: spec.permittedReceiver,
        permittedSender: spec.permittedSender,
      })
  );
}

export async function updateDeploymentAttempt(
  database: Database,
  input: {
    allowedStates?: readonly ("deploying" | "reconciliation_required")[];
    leaseToken: string;
    nowUnixSeconds: number;
    releaseId: string;
    requireUnexpired?: boolean;
    update: (attempt: DeploymentAttempt) => DeploymentAttempt;
    workerId: string;
  },
): Promise<DeploymentAttempt> {
  return database.begin(async (transaction) => {
    const [current] = await transaction<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${input.releaseId}
    `;
    if (current === undefined) {
      throw new PersistenceError("release_not_found", "Release not found.");
    }
    await validateApprovedRelease(
      current,
      input.nowUnixSeconds,
      input.allowedStates ?? ["deploying"],
      input.requireUnexpired ?? true,
    );
    if (
      current.state === "reconciliation_required" &&
      current.reconciliationKind !== "deployment"
    ) {
      throw new PersistenceError(
        "transition_rejected",
        "This release is reconciling a different chain operation.",
      );
    }
    const parsed = deploymentAttemptSchema.safeParse(current.deploymentAttempt);
    if (!parsed.success || !deploymentMatchesRelease(parsed.data, current)) {
      throw new PersistenceError(
        "transition_rejected",
        "The stored deployment attempt is malformed or stale.",
      );
    }
    const attempt = deploymentAttemptSchema.parse(input.update(parsed.data));
    const changed = await transaction`
      UPDATE releases
      SET deployment_attempt = ${transaction.json(attempt)}
      WHERE id = ${input.releaseId}
        AND version = ${current.version}
        AND lease_owner = ${input.workerId}
        AND lease_token = ${input.leaseToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    if (changed.length === 0) {
      throw new PersistenceError(
        "lease_lost",
        "This worker no longer owns the release lease.",
      );
    }
    return attempt;
  });
}
