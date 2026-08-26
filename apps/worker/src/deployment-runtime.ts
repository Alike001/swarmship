import type { Model } from "@openai/agents";
import {
  confirmStylusDeployment,
  isStylusDeploymentPreparationCurrent,
  prepareStylusDeployment,
  reconcileStylusDeployment,
  type HeroPublicClient,
  type HeroWalletClient,
} from "@swarmship/chain";
import {
  runApprovedStylusDeployment,
  verifyApprovedStylusDeployment,
} from "@swarmship/deployer";
import type { WorkerChainEnvironment } from "@swarmship/domain/environment";
import type {
  DeploymentRepository,
  LeaseRepository,
} from "@swarmship/persistence";
import {
  reconstructApprovedArtifact,
  removeSourceWorkspace,
} from "@swarmship/verifier";

import type { DeploymentProcessorDependencies } from "./deployment-processor.js";

type DeploymentRuntimeInput = {
  chainEnvironment: WorkerChainEnvironment;
  deployments: DeploymentRepository;
  leaseSeconds: number;
  leases: LeaseRepository;
  model: Model;
  officialClient: HeroPublicClient;
  retrySeconds: number;
  walletClient: HeroWalletClient;
  workerId: string;
};

export function createDeploymentRuntime(
  input: DeploymentRuntimeInput,
): DeploymentProcessorDependencies {
  return {
    confirm: (transactionHash, contractAddress, release) => {
      if (release.specification === null) {
        throw new Error("Approved specification is missing.");
      }
      return confirmStylusDeployment(
        input.officialClient,
        transactionHash,
        contractAddress,
        release.specification,
      );
    },
    deploy: (release, nowUnixSeconds) => {
      if (
        release.specification === null ||
        release.buildEvidence === null ||
        release.verificationEvidence === null
      ) {
        throw new Error("Approved deployment evidence is missing.");
      }
      return runApprovedStylusDeployment({
        buildEvidence: release.buildEvidence,
        nowUnixSeconds,
        privateKey: input.chainEnvironment.RELAYER_PRIVATE_KEY,
        rpcUrl: input.chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
        specification: release.specification,
        verificationEvidence: release.verificationEvidence,
      });
    },
    deployments: input.deployments,
    leaseSeconds: input.leaseSeconds,
    leases: input.leases,
    model: input.model,
    prepareArtifact: async (release, nowUnixSeconds) => {
      if (
        release.specification === null ||
        release.buildEvidence === null ||
        release.verificationEvidence === null
      ) {
        throw new Error("Approved deployment evidence is missing.");
      }
      const workspace = await reconstructApprovedArtifact(
        release.buildEvidence,
        release.verificationEvidence,
        release.specification,
        nowUnixSeconds,
      );
      await removeSourceWorkspace(workspace.root);
      return workspace.artifactHash;
    },
    prepareChain: () => {
      const account = input.walletClient.account;
      if (account === undefined) {
        throw new Error("Deployment relayer account is missing.");
      }
      return prepareStylusDeployment(input.officialClient, account.address);
    },
    reconcile: (reconciliation, release) => {
      if (release.specification === null) {
        throw new Error("Approved specification is missing.");
      }
      return reconcileStylusDeployment(input.officialClient, {
        ...reconciliation,
        specification: release.specification,
      });
    },
    retrySeconds: input.retrySeconds,
    validateChain: (prepared) =>
      isStylusDeploymentPreparationCurrent(input.officialClient, prepared),
    verify: (release, transactionHash, nowUnixSeconds) => {
      if (
        release.specification === null ||
        release.buildEvidence === null ||
        release.verificationEvidence === null
      ) {
        throw new Error("Approved deployment evidence is missing.");
      }
      return verifyApprovedStylusDeployment({
        buildEvidence: release.buildEvidence,
        nowUnixSeconds,
        rpcUrl: input.chainEnvironment.ARBITRUM_SEPOLIA_RPC_URL,
        specification: release.specification,
        transactionHash,
        verificationEvidence: release.verificationEvidence,
      });
    },
    workerId: input.workerId,
  };
}
