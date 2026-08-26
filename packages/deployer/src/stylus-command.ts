import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BuildEvidenceV1 } from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import {
  executeFixedCommand,
  reconstructApprovedArtifact,
  removeSourceWorkspace,
  type CommandExecutor,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";

import type {
  StylusDeploymentResult,
  StylusVerificationResult,
} from "./deployment-model.js";

const ADDRESS_MARKER = "deployed code at address:";
const HASH_MARKER = "deployment tx hash:";
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function classifyStylusDeploymentFailure(
  output: string,
  timedOut: boolean,
  limitExceeded: boolean,
): Extract<StylusDeploymentResult, { status: "unknown" }> {
  if (timedOut) return { status: "unknown", reason: "command_timed_out" };
  if (limitExceeded) {
    return { status: "unknown", reason: "output_limit_exceeded" };
  }
  const value = output.replaceAll(ANSI_ESCAPE, "").toLowerCase();
  if (
    value.includes("insufficient funds") ||
    value.includes("not enough funds")
  ) {
    return { status: "unknown", reason: "insufficient_funds" };
  }
  if (
    value.includes("invalid constructor") ||
    value.includes("constructor argument")
  ) {
    return { status: "unknown", reason: "constructor_invalid" };
  }
  if (value.includes("deploy tx reverted")) {
    return { status: "unknown", reason: "transaction_reverted" };
  }
  if (
    value.includes("transport") ||
    value.includes("connection") ||
    value.includes("rpc error")
  ) {
    return { status: "unknown", reason: "rpc_unavailable" };
  }
  return { status: "unknown", reason: "command_failed" };
}

export function classifyStylusVerificationFailure(
  output: string,
  timedOut: boolean,
  limitExceeded: boolean,
): Extract<StylusVerificationResult, { status: "failed" }> {
  if (timedOut) return { status: "failed", reason: "command_timed_out" };
  if (limitExceeded) {
    return { status: "failed", reason: "output_limit_exceeded" };
  }
  const value = output.replaceAll(ANSI_ESCAPE, "").toLowerCase();
  if (value.includes("verification failed:")) {
    return { status: "failed", reason: "artifact_mismatch" };
  }
  if (
    value.includes("transport") ||
    value.includes("connection") ||
    value.includes("rpc error")
  ) {
    return { status: "failed", reason: "rpc_unavailable" };
  }
  return { status: "failed", reason: "command_failed" };
}

function markers(output: string, marker: string): string[] {
  const values = output
    .replaceAll(ANSI_ESCAPE, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().includes(marker))
    .map((line) => {
      const offset = line.toLowerCase().indexOf(marker) + marker.length;
      return line.slice(offset).trim().replace(/^"|"$/g, "");
    });
  return [...new Set(values)];
}

export function parseStylusDeploymentOutput(
  output: string,
): StylusDeploymentResult {
  const addresses = markers(output, ADDRESS_MARKER);
  const hashes = markers(output, HASH_MARKER);
  if (
    addresses.length !== 1 ||
    hashes.length !== 1 ||
    !ADDRESS.test(addresses[0] ?? "") ||
    !HASH.test(hashes[0] ?? "")
  ) {
    return { status: "unknown", reason: "output_invalid" };
  }
  return {
    status: "observed",
    contractAddress: addresses[0] as `0x${string}`,
    transactionHash: hashes[0] as `0x${string}`,
  };
}

type ApprovedCommandInput = {
  buildEvidence: BuildEvidenceV1;
  execute?: CommandExecutor;
  nowUnixSeconds: number;
  rpcUrl: string;
  specification: TaskRegistrySpecV1;
  verificationEvidence: VerificationEvidenceV1;
};

export async function runApprovedStylusDeployment(
  input: ApprovedCommandInput & { privateKey: `0x${string}` },
): Promise<StylusDeploymentResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.privateKey)) {
    throw new TypeError("The deployment key must be exactly 32 bytes.");
  }
  const execute = input.execute ?? executeFixedCommand;
  const workspace = await reconstructApprovedArtifact(
    input.buildEvidence,
    input.verificationEvidence,
    input.specification,
    input.nowUnixSeconds,
    execute,
  );
  let keyDirectory: string | null = null;
  try {
    keyDirectory = await mkdtemp(join(tmpdir(), "swarmship-key-"));
    const keyPath = join(keyDirectory, "relayer.key");
    await writeFile(keyPath, input.privateKey, {
      encoding: "utf8",
      mode: 0o600,
    });
    const spec = input.specification;
    const result = await execute({
      args: [
        "stylus",
        "deploy",
        "--no-verify",
        "--contract",
        "agent-task-registry",
        "--endpoint",
        input.rpcUrl,
        "--private-key-path",
        keyPath,
        "--constructor-args",
        spec.owner,
        spec.permittedSender,
        spec.permittedReceiver,
        String(spec.maxHandoffs),
        String(spec.expiry),
      ],
      command: "cargo",
      cwd: workspace.root,
      maxOutputBytes: 128_000,
      timeoutMs: 600_000,
    });
    if (result.exitCode !== 0 || result.timedOut || result.limitExceeded) {
      return classifyStylusDeploymentFailure(
        `${result.stdout}\n${result.stderr}`,
        result.timedOut,
        result.limitExceeded,
      );
    }
    return parseStylusDeploymentOutput(`${result.stdout}\n${result.stderr}`);
  } catch {
    return { status: "unknown", reason: "command_exception" };
  } finally {
    await removeSourceWorkspace(workspace.root);
    if (keyDirectory !== null) {
      await rm(keyDirectory, { force: true, recursive: true });
    }
  }
}

export async function verifyApprovedStylusDeployment(
  input: ApprovedCommandInput & { transactionHash: `0x${string}` },
): Promise<StylusVerificationResult> {
  const execute = input.execute ?? executeFixedCommand;
  const workspace = await reconstructApprovedArtifact(
    input.buildEvidence,
    input.verificationEvidence,
    input.specification,
    input.nowUnixSeconds,
    execute,
  );
  try {
    try {
      const result = await execute({
        args: [
          "stylus",
          "verify",
          "--no-verify",
          "--contract",
          "agent-task-registry",
          "--endpoint",
          input.rpcUrl,
          "--deployment-tx",
          input.transactionHash,
        ],
        command: "cargo",
        cwd: workspace.root,
        maxOutputBytes: 128_000,
        timeoutMs: 600_000,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.exitCode !== 0 || result.timedOut || result.limitExceeded) {
        return classifyStylusVerificationFailure(
          output,
          result.timedOut,
          result.limitExceeded,
        );
      }
      return output.includes("Verification successful")
        ? { status: "passed" }
        : { status: "failed", reason: "output_invalid" };
    } catch {
      return { status: "failed", reason: "command_exception" };
    }
  } finally {
    await removeSourceWorkspace(workspace.root);
  }
}
