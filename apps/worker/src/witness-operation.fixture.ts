import type {
  HeroAnchorBroadcast,
  HeroAnchorConfirmation,
  HeroAnchorPreparation,
  HeroAnchorReconciliation,
  HeroProofRecord,
  StylusWitnessObservation,
} from "@swarmship/chain";
import {
  createReleaseReceipt,
  hashReleaseReceipt,
} from "@swarmship/domain/release";
import type { StylusVerificationResult } from "@swarmship/deployer";
import type {
  ReceiptAnchorAttempt,
  ReceiptEvidenceV1,
  ReleaseLease,
} from "@swarmship/persistence";
import { vi } from "vitest";

export const MANIFEST = `0x${"a".repeat(64)}` as const;
export const DEPLOYMENT_TX = `0x${"b".repeat(64)}` as const;
export const ANCHOR_TX = `0x${"c".repeat(64)}` as const;
const ARTIFACT = `0x${"d".repeat(64)}` as const;
const CODE_HASH = `0x${"e".repeat(64)}` as const;
const RELEASE_ID = `0x${"f".repeat(64)}` as const;
const OWNER = "0x0000000000000000000000000000000000000001" as const;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;
const RELAYER = "0x0000000000000000000000000000000000000004" as const;
const CONTRACT = "0x0000000000000000000000000000000000000005" as const;
const SPECIFICATION = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: OWNER,
  permittedSender: SENDER,
  permittedReceiver: RECEIVER,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};
const RECEIPT = createReleaseReceipt({
  version: 1,
  releaseId: RELEASE_ID,
  manifestRoot: MANIFEST,
  artifactHash: ARTIFACT,
  deploymentTransaction: DEPLOYMENT_TX,
  deployedAddress: CONTRACT,
  chainId: 421614,
  deploymentBlockNumber: "120",
  deploymentSender: RELAYER,
  deploymentNonce: "7",
  observedCodeHash: CODE_HASH,
  observedSpecification: SPECIFICATION,
  activatedVersion: 1,
  handoffCount: "0",
  sourceVerification: "passed",
});
export const RECEIPT_ROOT = hashReleaseReceipt(RECEIPT);
const RECEIPT_EVIDENCE: ReceiptEvidenceV1 = {
  version: 1,
  receipt: RECEIPT,
  receiptRoot: RECEIPT_ROOT,
  officialChainId: 421614,
  witnessChainId: 421614,
};

function proof(root: `0x${string}`): HeroProofRecord {
  return {
    anchored: true,
    proofRoot: root,
    submitter: RELAYER,
    timestamp: 123n,
  };
}

export function prepared(
  status: Extract<
    ReceiptAnchorAttempt,
    { kind: "prepared" }
  >["status"] = "prepared",
): Extract<ReceiptAnchorAttempt, { kind: "prepared" }> {
  return {
    kind: "prepared",
    nonce: 8,
    proofRoot: RECEIPT_ROOT,
    sender: RELAYER,
    startBlock: "100",
    status,
    transactionHash: status === "submitted" ? ANCHOR_TX : null,
    version: 1,
  };
}

function releaseLease(
  state:
    | "deployed_unverified"
    | "anchoring_receipt"
    | "reconciliation_required" = "deployed_unverified",
  attempt: ReceiptAnchorAttempt | null = null,
): ReleaseLease {
  return {
    token: "00000000-0000-4000-8000-000000000001",
    release: {
      id: "00000000-0000-4000-8000-000000000002",
      state,
      version: 7,
      reconciliationKind:
        state === "reconciliation_required" ? "receipt_anchor" : null,
      specification: SPECIFICATION,
      manifestApproval: {
        digest: MANIFEST,
        manifest: { releaseId: RELEASE_ID },
      },
      deploymentAttempt: {
        artifactHash: ARTIFACT,
        contractAddress: CONTRACT,
        nonce: 7,
        sender: RELAYER,
        status: "confirmed",
        transactionHash: DEPLOYMENT_TX,
        verificationStatus: "passed",
      },
      receiptAnchorAttempt: attempt,
      receiptEvidence:
        state === "deployed_unverified" ? null : RECEIPT_EVIDENCE,
    } as unknown as ReleaseLease["release"],
  };
}

function observation(): Extract<
  StylusWitnessObservation,
  { status: "confirmed" }
> {
  return {
    status: "confirmed",
    chainId: 421614,
    blockNumber: 120n,
    codeHash: CODE_HASH,
    inspection: {
      activatedVersion: 1,
      address: CONTRACT,
      bytecode: "0x6001",
      configuration: SPECIFICATION,
      handoffCount: 0n,
    },
    nonce: 7,
    sender: RELAYER,
    transactionHash: DEPLOYMENT_TX,
  };
}

export function witnessDependencies(
  input: {
    attempt?: ReceiptAnchorAttempt | null;
    state?:
      "deployed_unverified" | "anchoring_receipt" | "reconciliation_required";
  } = {},
) {
  const calls: string[] = [];
  const receipts = {
    markBroadcasting: vi.fn(async () => {
      calls.push("persist-broadcasting");
      return prepared("broadcasting");
    }),
    markSubmitted: vi.fn(async () => {
      calls.push("persist-submitted");
      return prepared("submitted");
    }),
  };
  const broadcast = vi.fn(async (): Promise<HeroAnchorBroadcast> => {
    calls.push("broadcast");
    return { kind: "submitted", transactionHash: ANCHOR_TX };
  });
  return {
    broadcast,
    calls,
    confirm: vi.fn(async (): Promise<HeroAnchorConfirmation> => ({
      blockNumber: 130n,
      logIndex: 0,
      proof: proof(RECEIPT_ROOT),
      status: "confirmed",
      transactionHash: ANCHOR_TX,
    })),
    inspectOfficial: vi.fn(async () => ({
      address: CONTRACT,
      bytecode: "0x6001" as const,
      chainId: 421614,
    })),
    inspectWitness: vi.fn(async () => ({
      address: CONTRACT,
      bytecode: "0x6001" as const,
      chainId: 421614,
    })),
    lease: releaseLease(input.state, input.attempt),
    nowUnixSeconds: 1_800_000_000,
    observeDeployment: vi.fn(async (): Promise<StylusWitnessObservation> =>
      observation(),
    ),
    prepare: vi.fn(async (): Promise<HeroAnchorPreparation> => ({
      kind: "ready",
      nonce: 8,
      proofRoot: RECEIPT_ROOT,
      sender: RELAYER,
      startBlock: 100n,
    })),
    receipts,
    reconcileOfficial: vi.fn(async (): Promise<HeroAnchorReconciliation> => ({
      observedBlock: 130n,
      proof: proof(RECEIPT_ROOT),
      status: "present",
    })),
    reconcileWitness: vi.fn(async (): Promise<HeroAnchorReconciliation> => ({
      observedBlock: 130n,
      proof: proof(RECEIPT_ROOT),
      status: "present",
    })),
    verifyManifestWitness: vi.fn(async () => proof(MANIFEST)),
    verifyReceiptOfficial: vi.fn(async () => proof(RECEIPT_ROOT)),
    verifyReceiptWitness: vi.fn(async () => proof(RECEIPT_ROOT)),
    verifySource: vi.fn(async (): Promise<StylusVerificationResult> => ({
      status: "passed",
    })),
    workerId: "witness-worker",
  };
}
