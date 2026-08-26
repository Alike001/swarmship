import type { Address, Hash, Hex } from "viem";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";

export type ProofRoot = `0x${string}`;

export type HeroProofRecord = {
  anchored: boolean;
  proofRoot: ProofRoot;
  submitter: Address;
  timestamp: bigint;
};

export type PreparedHeroAnchor = {
  kind: "ready";
  proofRoot: ProofRoot;
  sender: Address;
  nonce: number;
  startBlock: bigint;
};

export type ExistingHeroAnchor = {
  kind: "already_anchored";
  proof: HeroProofRecord;
};

export type HeroAnchorPreparation = PreparedHeroAnchor | ExistingHeroAnchor;
export type HeroAnchorBroadcast =
  ExistingHeroAnchor | { kind: "submitted"; transactionHash: Hash };

export type HeroAnchorConfirmation =
  | {
      status: "confirmed";
      transactionHash: Hash;
      blockNumber: bigint;
      logIndex: number;
      proof: HeroProofRecord;
    }
  | { status: "reverted"; transactionHash: Hash; blockNumber: bigint }
  | {
      status: "unknown";
      transactionHash: Hash;
      reason:
        | "receipt_unavailable"
        | "proof_event_missing"
        | "proof_read_failed"
        | "proof_mismatch";
    };

export type HeroAnchorReconciliation =
  | { status: "present"; observedBlock: bigint; proof: HeroProofRecord }
  | { status: "missing"; observedBlock: bigint }
  | {
      status: "inconclusive";
      observedBlock: bigint | null;
      reason:
        | "observation_block_not_reached"
        | "rpc_unavailable"
        | "inconsistent_evidence";
    };

export type HeroDeploymentInspection = {
  address: Address;
  chainId: number;
  bytecode: Hex;
};

export type PreparedStylusDeployment = {
  nonce: number;
  sender: Address;
  startBlock: bigint;
};

export type StylusRegistryInspection = {
  activatedVersion: number;
  address: Address;
  bytecode: Hex;
  configuration: Omit<TaskRegistrySpecV1, "contractFamily">;
  handoffCount: bigint;
};

export type StylusDeploymentConfirmation =
  | {
      status: "confirmed";
      blockNumber: bigint;
      inspection: StylusRegistryInspection;
      transactionHash: Hash;
    }
  | { status: "reverted"; blockNumber: bigint; transactionHash: Hash }
  | {
      status: "unknown";
      reason:
        | "receipt_unavailable"
        | "deployment_event_missing"
        | "address_mismatch"
        | "registry_read_failed"
        | "configuration_mismatch";
      transactionHash: Hash;
    };

export type StylusDeploymentReconciliation =
  | {
      status: "present";
      contractAddress: Address;
      observedBlock: bigint;
      transactionHash: Hash;
    }
  | { status: "missing"; observedBlock: bigint }
  | {
      status: "inconclusive";
      observedBlock: bigint | null;
      reason:
        | "observation_block_not_reached"
        | "rpc_unavailable"
        | "transaction_not_found"
        | "configuration_mismatch";
    };
