import type { Address } from "viem";

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
export const HERO_PROOF_ANCHOR_ADDRESS =
  "0x75B1E01222bC1bEFfd023A71762fec796FeE181A" as Address;

export const HERO_PROOF_ANCHOR_ABI = [
  {
    inputs: [{ internalType: "bytes32", name: "proofRoot", type: "bytes32" }],
    name: "AlreadyAnchored",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "proofRoot",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "submitter",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "timestamp",
        type: "uint64",
      },
    ],
    name: "ProofAnchored",
    type: "event",
  },
  {
    inputs: [{ internalType: "bytes32", name: "proofRoot", type: "bytes32" }],
    name: "anchor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32[]",
        name: "proofRoots",
        type: "bytes32[]",
      },
    ],
    name: "anchorBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "proofRoot", type: "bytes32" }],
    name: "verify",
    outputs: [
      { internalType: "bool", name: "anchored", type: "bool" },
      { internalType: "uint64", name: "timestamp", type: "uint64" },
      { internalType: "address", name: "submitter", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
