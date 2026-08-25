import { createHash } from "node:crypto";

import {
  VERIFICATION_VERSION,
  hashVerificationValue,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";

export function passedVerificationEvidence(
  buildEvidenceRef: `0x${string}`,
): VerificationEvidenceV1 {
  const artifact = Buffer.from("verified-wasm");
  const artifactBase64 = artifact.toString("base64");
  const artifactHash = `0x${createHash("sha256")
    .update("swarmship-wasm-artifact-v1")
    .update("\0")
    .update(artifact)
    .digest("hex")}` as const;
  const toolchain = {
    cargo: "cargo 1.96.0 (30a34c682 2026-05-25)",
    cargoStylus: "stylus 0.10.9",
    rustc: "rustc 1.96.0 (ac68faa20 2026-05-25)",
  };
  const checks = [
    {
      args: ["fmt", "--all", "--", "--check"],
      command: "cargo",
      exitCode: 0,
      name: "rust_format",
      status: "passed",
    },
    {
      args: ["test", "--locked", "--workspace", "--all-features"],
      command: "cargo",
      exitCode: 0,
      name: "rust_tests",
      status: "passed",
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
      exitCode: 0,
      name: "wasm_build",
      status: "passed",
    },
    {
      args: [
        "stylus",
        "check",
        "--contract",
        "agent-task-registry",
        "--endpoint",
        "https://sepolia-rollup.arbitrum.io/rpc",
      ],
      command: "cargo",
      exitCode: 0,
      name: "stylus_check",
      status: "passed",
    },
  ] as VerificationEvidenceV1["checks"];
  const toolchainHash = hashVerificationValue(
    "swarmship-toolchain-v1",
    toolchain,
  );
  const testEvidenceHash = hashVerificationValue(
    "swarmship-verification-checks-v1",
    checks,
  );
  const evidenceRef = hashVerificationValue(
    "swarmship-verification-evidence-v1",
    {
      artifactHash,
      buildEvidenceRef,
      status: "passed",
      testEvidenceHash,
      toolchainHash,
      version: VERIFICATION_VERSION,
    },
  );
  return {
    artifactBase64,
    artifactHash,
    buildEvidenceRef,
    checks,
    evidenceRef,
    status: "passed",
    testEvidenceHash,
    toolchain,
    toolchainHash,
    version: VERIFICATION_VERSION,
  };
}

export function failedVerificationEvidence(
  buildEvidenceRef: `0x${string}`,
): VerificationEvidenceV1 {
  const toolchain = {
    cargo: "cargo 1.96.0 (30a34c682 2026-05-25)",
    cargoStylus: "stylus 0.10.9",
    rustc: "rustc 1.96.0 (ac68faa20 2026-05-25)",
  };
  const checks = [
    {
      args: ["fmt", "--all", "--", "--check"],
      command: "cargo",
      exitCode: 1,
      name: "rust_format",
      status: "failed",
    },
  ] as VerificationEvidenceV1["checks"];
  const toolchainHash = hashVerificationValue(
    "swarmship-toolchain-v1",
    toolchain,
  );
  const testEvidenceHash = hashVerificationValue(
    "swarmship-verification-checks-v1",
    checks,
  );
  const evidenceRef = hashVerificationValue(
    "swarmship-verification-evidence-v1",
    {
      artifactHash: null,
      buildEvidenceRef,
      status: "failed",
      testEvidenceHash,
      toolchainHash,
      version: VERIFICATION_VERSION,
    },
  );
  return {
    artifactBase64: null,
    artifactHash: null,
    buildEvidenceRef,
    checks,
    evidenceRef,
    status: "failed",
    testEvidenceHash,
    toolchain,
    toolchainHash,
    version: VERIFICATION_VERSION,
  };
}
