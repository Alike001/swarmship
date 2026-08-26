import type { Address } from "viem";

export const STYLUS_DEPLOYER_ADDRESS =
  "0xcEcba2F1DC234f70Dd89F2041029807F8D03A990" as Address;
export const ARB_WASM_ADDRESS =
  "0x0000000000000000000000000000000000000071" as Address;

export const STYLUS_DEPLOYER_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "deployedContract",
        type: "address",
      },
    ],
    name: "ContractDeployed",
    type: "event",
  },
] as const;

export const ARB_WASM_ABI = [
  {
    inputs: [{ internalType: "address", name: "program", type: "address" }],
    name: "programVersion",
    outputs: [{ internalType: "uint16", name: "version", type: "uint16" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const getter = (name: string, type: string) => ({
  inputs: [],
  name,
  outputs: [{ internalType: type, name: "", type }],
  stateMutability: "view",
  type: "function",
});

export const AGENT_TASK_REGISTRY_ABI = [
  getter("owner", "address"),
  getter("permittedSender", "address"),
  getter("permittedReceiver", "address"),
  getter("maxHandoffs", "uint64"),
  getter("expiry", "uint64"),
  getter("handoffCount", "uint64"),
] as const;
