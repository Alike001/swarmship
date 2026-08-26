import { createHash } from "node:crypto";

export const VERIFICATION_VERSION = "agent-task-registry-verification-v1";
export const STYLUS_CHECK_ENDPOINT = "https://sepolia-rollup.arbitrum.io/rpc";

export type VerificationCheck = {
  args: string[];
  command: string;
  exitCode: number | null;
  name: "rust_format" | "rust_tests" | "wasm_build" | "stylus_check";
  status: "passed" | "failed";
};

export type ToolchainEvidence = {
  cargo: string;
  cargoStylus: string;
  rustc: string;
};

export type VerificationEvidenceV1 = {
  artifactBase64: string | null;
  artifactHash: `0x${string}` | null;
  buildEvidenceRef: `0x${string}`;
  checks: VerificationCheck[];
  evidenceRef: `0x${string}`;
  status: "passed" | "failed";
  testEvidenceHash: `0x${string}`;
  toolchain: ToolchainEvidence;
  toolchainHash: `0x${string}`;
  version: typeof VERIFICATION_VERSION;
};

export type VerifierErrorCode =
  "command_unavailable" | "invalid_build_evidence" | "workspace_invalid";

export class VerifierError extends Error {
  constructor(
    public readonly code: VerifierErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VerifierError";
  }
}

export function hashVerificationValue(
  tag: string,
  value: unknown,
): `0x${string}` {
  return `0x${createHash("sha256")
    .update(tag)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export const verificationCheckPlan = [
  {
    args: ["fmt", "--all", "--", "--check"],
    command: "cargo",
    name: "rust_format",
    timeoutMs: 60_000,
  },
  {
    args: ["test", "--locked", "--workspace", "--all-features"],
    command: "cargo",
    name: "rust_tests",
    timeoutMs: 360_000,
  },
  {
    args: [
      "build",
      "--locked",
      "--release",
      "--target",
      "wasm32-unknown-unknown",
      "--workspace",
    ],
    command: "cargo",
    name: "wasm_build",
    timeoutMs: 300_000,
  },
  {
    args: [
      "stylus",
      "check",
      "--contract",
      "agent-task-registry",
      "--endpoint",
      STYLUS_CHECK_ENDPOINT,
    ],
    command: "cargo",
    name: "stylus_check",
    timeoutMs: 180_000,
  },
] as const;
