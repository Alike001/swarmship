import { applyReleaseTransition } from "@swarmship/domain/release";
import {
  deploymentAttemptSchema,
  type DeploymentAttempt,
} from "@swarmship/deployer";

import type { TransactionDatabase } from "./database.js";
import { PersistenceError } from "./errors.js";
import type {
  DeploymentOutcomeInput,
  DeploymentPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export function safeDeploymentSummary(summary: string): string {
  const value = summary.trim();
  if (value.length < 1 || value.length > 600) {
    throw new PersistenceError(
      "transition_rejected",
      "The deployment summary is missing or too long.",
    );
  }
  return value;
}

export function deploymentTransition(
  current: ReleaseRow,
  input: DeploymentPreparedInput | DeploymentOutcomeInput,
) {
  const result = applyReleaseTransition(
    {
      state: current.state,
      version: current.version,
      reconciliation: current.reconciliationKind,
    },
    input.command,
  );
  if (!result.success) {
    throw new PersistenceError("transition_rejected", result.error.message);
  }
  return result;
}

export function nextDeploymentAttempt(
  attempt: DeploymentAttempt,
  event: DeploymentOutcomeInput["command"]["event"],
): DeploymentAttempt | null {
  if (
    event === "deployment_reverted" ||
    event === "deployment_reconciled_missing" ||
    event === "deployment_verification_rejected"
  ) {
    return null;
  }
  if (event === "deployment_unknown") {
    return deploymentAttemptSchema.parse({ ...attempt, status: "unknown" });
  }
  return deploymentAttemptSchema.parse({ ...attempt, status: "confirmed" });
}

export async function saveDeploymentTransition(input: {
  attempt: DeploymentAttempt | null;
  current: ReleaseRow;
  input: DeploymentPreparedInput | DeploymentOutcomeInput;
  result: ReturnType<typeof deploymentTransition>;
  summary: string;
  transaction: TransactionDatabase;
}): Promise<ReleaseTransitionRow> {
  const { attempt, current, result, summary, transaction } = input;
  const previousAttempt = deploymentAttemptSchema.safeParse(
    current.deploymentAttempt,
  );
  const evidenceAttempt =
    attempt ??
    (input.input.command.event === "deployment_verification_rejected" &&
    previousAttempt.success
      ? previousAttempt.data
      : null);
  const updated = await transaction`
    UPDATE releases
    SET state = ${result.snapshot.state},
        version = ${result.snapshot.version},
        reconciliation_kind = ${result.snapshot.reconciliation},
        deployment_attempt = ${attempt === null ? null : transaction.json(attempt)},
        safe_error = NULL,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = ${input.input.releaseId}
      AND version = ${current.version}
      AND lease_owner = ${input.input.workerId}
      AND lease_token = ${input.input.leaseToken}
      AND lease_expires_at > clock_timestamp()
    RETURNING id
  `;
  if (updated.length === 0) {
    throw new PersistenceError(
      "lease_lost",
      "This worker no longer owns the release lease.",
    );
  }
  const [transition] = await transaction<ReleaseTransitionRow[]>`
    INSERT INTO release_transitions (
      release_id, version_before, version_after, actor, event,
      from_state, to_state, evidence_ref, effects, tool_name,
      safe_summary, deterministic_result
    ) VALUES (
      ${input.input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
      ${result.record.actor}, ${result.record.event}, ${result.record.from},
      ${result.record.to}, ${result.record.evidenceRef},
      ${transaction.json(result.record.effects)}, ${"request_guarded_deployment"},
      ${summary}, ${transaction.json({
        artifactHash:
          evidenceAttempt?.artifactHash ??
          current.verificationEvidence?.artifactHash,
        contractAddress: evidenceAttempt?.contractAddress ?? null,
        status:
          input.input.command.event === "deployment_verification_rejected"
            ? "verification_rejected"
            : (attempt?.status ?? "retryable"),
        transactionHash: evidenceAttempt?.transactionHash ?? null,
      })}
    )
    RETURNING *
  `;
  if (transition === undefined) {
    throw new Error("Deployment transition insert returned no row.");
  }
  return transition;
}
