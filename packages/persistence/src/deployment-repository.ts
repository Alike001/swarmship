import {
  deploymentAttemptSchema,
  type DeploymentAttempt,
} from "@swarmship/deployer";

import type { Database } from "./database.js";
import {
  deploymentMatchesRelease,
  updateDeploymentAttempt,
} from "./deployment-attempt.js";
import {
  deploymentTransition,
  nextDeploymentAttempt,
  safeDeploymentSummary,
  saveDeploymentTransition,
} from "./deployment-transition.js";
import { PersistenceError } from "./errors.js";
import { validateApprovedRelease } from "./release-guard.js";
import type {
  DeploymentOutcomeInput,
  DeploymentPreparedInput,
  ReleaseRow,
  ReleaseTransitionRow,
} from "./types.js";

export class DeploymentRepository {
  constructor(private readonly database: Database) {}

  async getAuthorizedDigest(
    releaseId: string,
    nowUnixSeconds: number,
  ): Promise<`0x${string}`> {
    const [current] = await this.database<ReleaseRow[]>`
      SELECT * FROM releases WHERE id = ${releaseId}
    `;
    if (current === undefined) {
      throw new PersistenceError("release_not_found", "Release not found.");
    }
    const approval = await validateApprovedRelease(current, nowUnixSeconds, [
      "approved_not_deployed",
    ]);
    return approval.digest;
  }

  async recordPrepared(
    input: DeploymentPreparedInput,
  ): Promise<ReleaseTransitionRow> {
    const attempt = deploymentAttemptSchema.parse(input.attempt);
    const summary = safeDeploymentSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const approval = await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["approved_not_deployed"],
      );
      if (
        !deploymentMatchesRelease(attempt, current) ||
        attempt.status !== "prepared" ||
        input.command.actor !== "deployment" ||
        input.command.event !== "deployment_started" ||
        input.command.evidenceRef !== approval.digest
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The prepared deployment does not match the approved release.",
        );
      }
      const result = deploymentTransition(current, input);
      return saveDeploymentTransition({
        attempt,
        current,
        input,
        result,
        summary,
        transaction,
      });
    });
  }

  async markRunning(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<DeploymentAttempt> {
    return updateDeploymentAttempt(this.database, {
      leaseToken,
      nowUnixSeconds,
      releaseId,
      update: (attempt) => {
        if (attempt.status !== "prepared") {
          throw new PersistenceError(
            "transition_rejected",
            "The deployment is not ready to run.",
          );
        }
        return { ...attempt, status: "running" };
      },
      workerId,
    });
  }

  async markObserved(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    contractAddress: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<DeploymentAttempt> {
    return updateDeploymentAttempt(this.database, {
      allowedStates: ["deploying"],
      leaseToken,
      nowUnixSeconds,
      releaseId,
      requireUnexpired: false,
      update: (attempt) => {
        if (attempt.status !== "running") {
          throw new PersistenceError(
            "transition_rejected",
            "The deployment is not awaiting observed chain identifiers.",
          );
        }
        return {
          ...attempt,
          contractAddress,
          status: "observed",
          transactionHash,
        };
      },
      workerId,
    });
  }

  async markReconciledObserved(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    transactionHash: `0x${string}`,
    contractAddress: `0x${string}`,
    nowUnixSeconds: number,
  ): Promise<DeploymentAttempt> {
    return updateDeploymentAttempt(this.database, {
      allowedStates: ["reconciliation_required"],
      leaseToken,
      nowUnixSeconds,
      releaseId,
      requireUnexpired: false,
      update: (attempt) => {
        if (attempt.status !== "unknown") {
          throw new PersistenceError(
            "transition_rejected",
            "The deployment is not awaiting reconciled identifiers.",
          );
        }
        return {
          ...attempt,
          contractAddress,
          status: "observed",
          transactionHash,
        };
      },
      workerId,
    });
  }

  async markVerified(
    releaseId: string,
    workerId: string,
    leaseToken: string,
    nowUnixSeconds: number,
  ): Promise<DeploymentAttempt> {
    return updateDeploymentAttempt(this.database, {
      allowedStates: ["deploying", "reconciliation_required"],
      leaseToken,
      nowUnixSeconds,
      releaseId,
      requireUnexpired: false,
      update: (attempt) => {
        if (
          attempt.status !== "observed" ||
          attempt.transactionHash === null ||
          attempt.contractAddress === null
        ) {
          throw new PersistenceError(
            "transition_rejected",
            "The deployment has no complete observed chain identifiers.",
          );
        }
        return { ...attempt, verificationStatus: "passed" };
      },
      workerId,
    });
  }

  async recordOutcome(
    input: DeploymentOutcomeInput,
  ): Promise<ReleaseTransitionRow> {
    const summary = safeDeploymentSummary(input.summary);
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<ReleaseRow[]>`
        SELECT * FROM releases WHERE id = ${input.releaseId}
      `;
      if (current === undefined) {
        throw new PersistenceError("release_not_found", "Release not found.");
      }
      const approval = await validateApprovedRelease(
        current,
        input.nowUnixSeconds,
        ["deploying", "reconciliation_required"],
        false,
      );
      const parsed = deploymentAttemptSchema.safeParse(
        current.deploymentAttempt,
      );
      if (
        !parsed.success ||
        !deploymentMatchesRelease(parsed.data, current) ||
        input.command.actor !== "deployment" ||
        input.command.evidenceRef !== approval.digest
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The stored deployment does not match the approved release.",
        );
      }
      const success = [
        "deployment_observed",
        "deployment_reconciled_present",
      ].includes(input.command.event);
      if (
        success &&
        (parsed.data.verificationStatus !== "passed" ||
          parsed.data.contractAddress === null ||
          parsed.data.transactionHash === null)
      ) {
        throw new PersistenceError(
          "transition_rejected",
          "The deployment cannot advance without verified chain evidence.",
        );
      }
      const result = deploymentTransition(current, input);
      return saveDeploymentTransition({
        attempt: nextDeploymentAttempt(parsed.data, input.command.event),
        current,
        input,
        result,
        summary,
        transaction,
      });
    });
  }
}
