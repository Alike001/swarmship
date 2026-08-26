import type { WitnessToolResult } from "@swarmship/agents";
import type { HeroProofRecord } from "@swarmship/chain";
import {
  createReleaseReceipt,
  hashReleaseReceipt,
} from "@swarmship/domain/release";
import {
  receiptAnchorAttemptSchema,
  receiptEvidenceSchema,
  type ReceiptAnchorAttempt,
  type ReceiptEvidenceV1,
  type ReleaseLease,
} from "@swarmship/persistence";

import type {
  WitnessOperationDependencies,
  WitnessOperationResult,
} from "./witness-operation.js";

export function witnessResult(
  status: WitnessToolResult["status"],
  event: WitnessToolResult["event"],
  evidenceRef: `0x${string}`,
): WitnessOperationResult {
  return {
    preparedAttempt: null,
    preparedEvidence: null,
    toolResult: { status, event, evidenceRef },
  };
}

export function matchingProofs(
  official: HeroProofRecord,
  witness: HeroProofRecord,
): boolean {
  return (
    official.anchored &&
    witness.anchored &&
    official.proofRoot === witness.proofRoot &&
    official.submitter.toLowerCase() === witness.submitter.toLowerCase() &&
    official.timestamp === witness.timestamp
  );
}

export function storedReceiptAttempt(
  lease: ReleaseLease,
): ReceiptAnchorAttempt {
  return receiptAnchorAttemptSchema.parse(lease.release.receiptAnchorAttempt);
}

export function assertStoredReceiptEvidence(lease: ReleaseLease): void {
  receiptEvidenceSchema.parse(lease.release.receiptEvidence);
}

export async function prepareWitnessEvidence(
  dependencies: WitnessOperationDependencies,
): Promise<WitnessOperationResult> {
  const { release } = dependencies.lease;
  const approval = release.manifestApproval;
  const deployment = release.deploymentAttempt;
  const specification = release.specification;
  if (
    approval === null ||
    deployment === null ||
    specification === null ||
    deployment.status !== "confirmed" ||
    deployment.verificationStatus !== "passed" ||
    deployment.transactionHash === null ||
    deployment.contractAddress === null
  ) {
    throw new Error("The verified deployment evidence is incomplete.");
  }

  const [officialHero, witnessHero, manifestProof, observation] =
    await Promise.all([
      dependencies.inspectOfficial(),
      dependencies.inspectWitness(),
      dependencies.verifyManifestWitness(approval.digest),
      dependencies.observeDeployment(),
    ]);
  if (!manifestProof.anchored || manifestProof.proofRoot !== approval.digest) {
    return witnessResult(
      "mismatch",
      "witness_rejected",
      deployment.transactionHash,
    );
  }
  if (observation.status !== "confirmed") {
    if (observation.status === "unknown") {
      throw new Error("Independent deployment evidence is unavailable.");
    }
    return witnessResult(
      "mismatch",
      "witness_rejected",
      deployment.transactionHash,
    );
  }
  if (
    observation.sender.toLowerCase() !== deployment.sender.toLowerCase() ||
    observation.nonce !== deployment.nonce
  ) {
    return witnessResult(
      "mismatch",
      "witness_rejected",
      deployment.transactionHash,
    );
  }

  const sourceVerification = await dependencies.verifySource();
  if (sourceVerification.status !== "passed") {
    if (sourceVerification.reason !== "artifact_mismatch") {
      throw new Error("Independent source verification is unavailable.");
    }
    return witnessResult(
      "mismatch",
      "witness_rejected",
      deployment.transactionHash,
    );
  }

  const receipt = createReleaseReceipt({
    version: 1,
    releaseId: approval.manifest.releaseId,
    manifestRoot: approval.digest,
    artifactHash: deployment.artifactHash,
    deploymentTransaction: deployment.transactionHash,
    deployedAddress: deployment.contractAddress,
    chainId: observation.chainId as 421614,
    deploymentBlockNumber: observation.blockNumber.toString(),
    deploymentSender: observation.sender,
    deploymentNonce: observation.nonce.toString(),
    observedCodeHash: observation.codeHash,
    observedSpecification: {
      contractFamily: specification.contractFamily,
      ...observation.inspection.configuration,
    },
    activatedVersion: observation.inspection.activatedVersion,
    handoffCount: observation.inspection.handoffCount.toString(),
    sourceVerification: "passed",
  });
  const receiptRoot = hashReleaseReceipt(receipt);
  const preparation = await dependencies.prepare(receiptRoot);
  const attempt: ReceiptAnchorAttempt =
    preparation.kind === "already_anchored"
      ? {
          kind: "existing",
          proofRoot: preparation.proof.proofRoot,
          status: "existing",
          submitter: preparation.proof.submitter,
          timestamp: preparation.proof.timestamp.toString(),
          transactionHash: null,
          version: 1,
        }
      : {
          kind: "prepared",
          nonce: preparation.nonce,
          proofRoot: preparation.proofRoot,
          sender: preparation.sender,
          startBlock: preparation.startBlock.toString(),
          status: "prepared",
          transactionHash: null,
          version: 1,
        };
  const evidence: ReceiptEvidenceV1 = receiptEvidenceSchema.parse({
    version: 1,
    receipt,
    receiptRoot,
    officialChainId: officialHero.chainId,
    witnessChainId: witnessHero.chainId,
  });
  return {
    preparedAttempt: receiptAnchorAttemptSchema.parse(attempt),
    preparedEvidence: evidence,
    toolResult: {
      status: "verified",
      event: "witness_confirmed",
      evidenceRef: receiptRoot,
    },
  };
}
