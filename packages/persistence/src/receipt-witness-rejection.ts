import { deploymentAttemptSchema } from "@swarmship/deployer";

import type { Database } from "./database.js";
import { deploymentMatchesRelease } from "./deployment-attempt.js";
import { PersistenceError } from "./errors.js";
import {
  receiptAnchorTransition,
  safeReceiptAnchorSummary,
} from "./receipt-anchor-transition.js";
import { validateApprovedRelease } from "./release-guard.js";
import type {
  ReleaseRow,
  ReleaseTransitionRow,
  WitnessRejectedInput,
} from "./types.js";

export async function recordWitnessRejection(
  database: Database,
  input: WitnessRejectedInput,
): Promise<ReleaseTransitionRow> {
  const summary = safeReceiptAnchorSummary(input.summary);
  if (
    !Number.isInteger(input.retrySeconds) ||
    input.retrySeconds < 1 ||
    input.retrySeconds > 3_600
  ) {
    throw new RangeError("Witness retry delay must be 1 to 3600 seconds.");
  }
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
      ["deployed_unverified"],
      false,
    );
    const deployment = deploymentAttemptSchema.safeParse(
      current.deploymentAttempt,
    );
    if (
      !deployment.success ||
      !deploymentMatchesRelease(deployment.data, current) ||
      deployment.data.transactionHash === null ||
      input.command.actor !== "witness" ||
      input.command.event !== "witness_rejected" ||
      input.command.evidenceRef !== deployment.data.transactionHash
    ) {
      throw new PersistenceError(
        "transition_rejected",
        "The rejected Witness observation does not match this deployment.",
      );
    }
    const result = receiptAnchorTransition(current, input);
    const updated = await transaction`
      UPDATE releases
      SET state = ${result.snapshot.state},
          version = ${result.snapshot.version},
          reconciliation_kind = ${result.snapshot.reconciliation},
          safe_error = ${transaction.json({
            code: "witness_mismatch",
            message:
              "Independent chain evidence did not match the approved deployment.",
          })},
          retry_count = retry_count + 1,
          next_attempt_at = clock_timestamp() + make_interval(secs => ${input.retrySeconds}),
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = ${input.releaseId}
        AND version = ${current.version}
        AND lease_owner = ${input.workerId}
        AND lease_token = ${input.leaseToken}
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
        ${input.releaseId}, ${result.record.versionBefore}, ${result.record.versionAfter},
        ${result.record.actor}, ${result.record.event}, ${result.record.from},
        ${result.record.to}, ${result.record.evidenceRef},
        ${transaction.json(result.record.effects)}, ${"read_independent_evidence"},
        ${summary}, ${transaction.json({ status: "mismatch" })}
      )
      RETURNING *
    `;
    if (transition === undefined) {
      throw new Error("Witness rejection transition insert returned no row.");
    }
    return transition;
  });
}
