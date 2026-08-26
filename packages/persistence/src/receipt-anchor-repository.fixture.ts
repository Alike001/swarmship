import { renderTaskRegistry } from "@swarmship/builder";
import type { DeploymentAttempt } from "@swarmship/deployer";
import {
  createReleaseReceipt,
  hashReleaseReceipt,
  toReleaseManifestTypedData,
} from "@swarmship/domain/release";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ApprovalRepository } from "./approval-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import { testDatabase } from "./test-database.js";
import { passedVerificationEvidence } from "./verification-evidence.fixture.js";

export const RECEIPT_TEST_NOW = 1_800_000_000;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;
export const RECEIPT_TEST_RELAYER =
  "0x0000000000000000000000000000000000000004" as const;
const CONTRACT = "0x0000000000000000000000000000000000000005" as const;
export const RECEIPT_TEST_DEPLOYMENT_TX = `0x${"6".repeat(64)}` as const;
export const RECEIPT_TEST_ANCHOR_TX = `0x${"7".repeat(64)}` as const;
const CODE_HASH = `0x${"8".repeat(64)}` as const;

const approvals = new ApprovalRepository(testDatabase);
const releases = new ReleaseRepository(testDatabase);

export async function createDeployedReceiptRelease() {
  const owner = privateKeyToAccount(generatePrivateKey());
  const specification = {
    contractFamily: "agent-task-registry-v1" as const,
    owner: owner.address,
    permittedSender: SENDER,
    permittedReceiver: RECEIVER,
    maxHandoffs: 5,
    expiry: 2_000_000_000,
  };
  const created = await releases.create({ originalRequest: "Registry" });
  const build = await renderTaskRegistry(specification, RECEIPT_TEST_NOW);
  const verification = passedVerificationEvidence(build.evidenceRef);
  await testDatabase`
    UPDATE releases
    SET state = 'awaiting_approval', version = 3,
        specification = ${testDatabase.json(specification)},
        build_evidence = ${testDatabase.json(build)},
        verification_evidence = ${testDatabase.json(verification)},
        updated_at = to_timestamp(${RECEIPT_TEST_NOW})
    WHERE id = ${created.release.id}
  `;
  const approvalRequest = await approvals.getRequest(
    created.release.id,
    RECEIPT_TEST_NOW + 1,
  );
  const signature = await owner.signTypedData(
    toReleaseManifestTypedData(approvalRequest.manifest),
  );
  await approvals.approve({
    expectedVersion: 3,
    nowUnixSeconds: RECEIPT_TEST_NOW + 1,
    releaseId: created.release.id,
    signature,
  });
  const deployment: DeploymentAttempt = {
    approvalDigest: approvalRequest.digest,
    artifactHash: verification.artifactHash!,
    constructor: {
      expiry: specification.expiry,
      maxHandoffs: specification.maxHandoffs,
      owner: specification.owner,
      permittedReceiver: specification.permittedReceiver,
      permittedSender: specification.permittedSender,
    },
    contractAddress: CONTRACT,
    nonce: 8,
    sender: RECEIPT_TEST_RELAYER,
    startBlock: "123",
    status: "confirmed",
    transactionHash: RECEIPT_TEST_DEPLOYMENT_TX,
    verificationStatus: "passed",
    version: 1,
  };
  await testDatabase`
    UPDATE releases
    SET state = 'deployed_unverified', version = 7,
        deployment_attempt = ${testDatabase.json(deployment)}
    WHERE id = ${created.release.id}
  `;
  const receipt = createReleaseReceipt({
    version: 1,
    releaseId: approvalRequest.manifest.releaseId,
    manifestRoot: approvalRequest.digest,
    artifactHash: deployment.artifactHash,
    deploymentTransaction: RECEIPT_TEST_DEPLOYMENT_TX,
    deployedAddress: CONTRACT,
    chainId: 421614,
    deploymentBlockNumber: "456",
    deploymentSender: RECEIPT_TEST_RELAYER,
    deploymentNonce: "8",
    observedCodeHash: CODE_HASH,
    observedSpecification: specification,
    activatedVersion: 1,
    handoffCount: "0",
    sourceVerification: "passed",
  });
  return {
    deployment,
    evidence: {
      version: 1 as const,
      receipt,
      receiptRoot: hashReleaseReceipt(receipt),
      officialChainId: 421614 as const,
      witnessChainId: 421614 as const,
    },
    releaseId: created.release.id,
  };
}
