import type { Model } from "@openai/agents";
import {
  broadcastHeroAnchor,
  confirmHeroAnchor,
  inspectHeroDeployment,
  observeStylusRelease,
  prepareHeroAnchor,
  reconcileHeroAnchor,
  verifyHeroProof,
  type HeroPublicClient,
  type HeroWalletClient,
} from "@swarmship/chain";
import { verifyApprovedStylusDeployment } from "@swarmship/deployer";
import type { WorkerChainEnvironment } from "@swarmship/domain/environment";
import type {
  LeaseRepository,
  ReceiptAnchorRepository,
} from "@swarmship/persistence";

import type { WitnessProcessorDependencies } from "./witness-processor.js";

export function createWitnessRuntime(input: {
  chainEnvironment: WorkerChainEnvironment;
  leaseSeconds: number;
  leases: LeaseRepository;
  model: Model;
  officialClient: HeroPublicClient;
  receipts: ReceiptAnchorRepository;
  retrySeconds: number;
  walletClient: HeroWalletClient;
  witnessClient: HeroPublicClient;
  workerId: string;
}): WitnessProcessorDependencies {
  return {
    broadcast: (prepared) =>
      broadcastHeroAnchor(input.officialClient, input.walletClient, prepared),
    confirm: (proofRoot, transactionHash) =>
      confirmHeroAnchor(input.officialClient, proofRoot, transactionHash),
    inspectOfficial: () => inspectHeroDeployment(input.officialClient),
    inspectWitness: () => inspectHeroDeployment(input.witnessClient),
    leaseSeconds: input.leaseSeconds,
    leases: input.leases,
    model: input.model,
    observeDeployment: (release) => {
      const attempt = release.deploymentAttempt;
      if (
        release.specification === null ||
        attempt === null ||
        attempt.transactionHash === null ||
        attempt.contractAddress === null
      ) {
        throw new Error("Witness deployment evidence is missing.");
      }
      return observeStylusRelease(
        input.witnessClient,
        attempt.transactionHash,
        attempt.contractAddress,
        release.specification,
      );
    },
    prepare: (proofRoot) =>
      prepareHeroAnchor(input.officialClient, input.walletClient, proofRoot),
    receipts: input.receipts,
    reconcileOfficial: (reconciliation) =>
      reconcileHeroAnchor(input.officialClient, reconciliation),
    reconcileWitness: (reconciliation) =>
      reconcileHeroAnchor(input.witnessClient, reconciliation),
    retrySeconds: input.retrySeconds,
    verifyManifestWitness: (proofRoot) =>
      verifyHeroProof(input.witnessClient, proofRoot),
    verifyReceiptOfficial: (proofRoot) =>
      verifyHeroProof(input.officialClient, proofRoot),
    verifyReceiptWitness: (proofRoot) =>
      verifyHeroProof(input.witnessClient, proofRoot),
    verifySource: (release) => {
      const attempt = release.deploymentAttempt;
      if (
        release.specification === null ||
        release.buildEvidence === null ||
        release.verificationEvidence === null ||
        release.manifestApproval === null ||
        attempt === null ||
        attempt.transactionHash === null
      ) {
        throw new Error("Witness source evidence is missing.");
      }
      return verifyApprovedStylusDeployment({
        buildEvidence: release.buildEvidence,
        nowUnixSeconds: release.manifestApproval.approvedAt,
        rpcUrl: input.chainEnvironment.ARBITRUM_SEPOLIA_WITNESS_RPC_URL,
        specification: release.specification,
        transactionHash: attempt.transactionHash,
        verificationEvidence: release.verificationEvidence,
      });
    },
    workerId: input.workerId,
  };
}
