import { hashReleaseReceipt } from "@swarmship/domain/release";
import { deploymentAttemptSchema } from "@swarmship/deployer";

import { deploymentMatchesRelease } from "./deployment-attempt.js";
import type { ReceiptEvidenceV1 } from "./receipt-anchor-model.js";
import type { ReleaseRow } from "./types.js";

export function receiptEvidenceMatchesRelease(
  evidence: ReceiptEvidenceV1,
  current: ReleaseRow,
): boolean {
  const deployment = deploymentAttemptSchema.safeParse(
    current.deploymentAttempt,
  );
  const approval = current.manifestApproval;
  const receipt = evidence.receipt;
  const specification = current.specification;
  return (
    deployment.success &&
    deploymentMatchesRelease(deployment.data, current) &&
    deployment.data.status === "confirmed" &&
    deployment.data.verificationStatus === "passed" &&
    deployment.data.transactionHash !== null &&
    deployment.data.contractAddress !== null &&
    approval !== null &&
    evidence.receiptRoot === hashReleaseReceipt(receipt) &&
    receipt.releaseId === approval.manifest.releaseId &&
    receipt.manifestRoot === approval.digest &&
    receipt.artifactHash === deployment.data.artifactHash &&
    receipt.deploymentTransaction === deployment.data.transactionHash &&
    receipt.deployedAddress.toLowerCase() ===
      deployment.data.contractAddress.toLowerCase() &&
    receipt.deploymentSender.toLowerCase() ===
      deployment.data.sender.toLowerCase() &&
    receipt.deploymentNonce === deployment.data.nonce.toString() &&
    specification !== null &&
    receipt.observedSpecification.contractFamily ===
      specification.contractFamily &&
    receipt.observedSpecification.owner === specification.owner &&
    receipt.observedSpecification.permittedSender ===
      specification.permittedSender &&
    receipt.observedSpecification.permittedReceiver ===
      specification.permittedReceiver &&
    receipt.observedSpecification.maxHandoffs === specification.maxHandoffs &&
    receipt.observedSpecification.expiry === specification.expiry
  );
}
