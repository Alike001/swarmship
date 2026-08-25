import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import {
  validateBuildEvidence,
  type BuildEvidenceV1,
} from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";

import {
  executeFixedCommand,
  type CommandExecutor,
  type CommandRequest,
  type CommandResult,
} from "./command-runner.js";
import {
  VERIFICATION_VERSION,
  VerifierError,
  hashVerificationValue,
  verificationCheckPlan,
  type ToolchainEvidence,
  type VerificationCheck,
  type VerificationEvidenceV1,
} from "./verification-model.js";

export type VerificationOptions = {
  execute?: CommandExecutor;
};

function hashBytes(tag: string, value: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(tag).update("\0").update(value).digest("hex")}`;
}

function normalizeVersion(result: CommandResult): string {
  const version = result.stdout.trim().replaceAll(/\s+/g, " ");
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.limitExceeded ||
    version.length < 1 ||
    version.length > 240
  ) {
    throw new VerifierError(
      "command_unavailable",
      "A pinned verification tool is unavailable or returned unsafe output.",
    );
  }
  return version;
}

async function runCommand(
  execute: CommandExecutor,
  cwd: string,
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandResult> {
  const request: CommandRequest = {
    args,
    command,
    cwd,
    maxOutputBytes: 96_000,
    timeoutMs,
  };
  try {
    return await execute(request);
  } catch {
    throw new VerifierError(
      "command_unavailable",
      "A pinned verification tool could not be started.",
    );
  }
}

async function writeWorkspace(
  root: string,
  evidence: BuildEvidenceV1,
): Promise<void> {
  const canonicalRoot = await realpath(root);
  for (const file of evidence.sourceFiles) {
    const destination = resolve(canonicalRoot, file.path);
    if (!destination.startsWith(`${canonicalRoot}${sep}`)) {
      throw new VerifierError(
        "workspace_invalid",
        "The verification source contains an unsafe path.",
      );
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.content, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

async function assertWorkspaceUnchanged(
  root: string,
  evidence: BuildEvidenceV1,
): Promise<void> {
  for (const file of evidence.sourceFiles) {
    const current = await readFile(resolve(root, file.path), "utf8");
    if (current !== file.content) {
      throw new VerifierError(
        "workspace_invalid",
        "A verification command changed the accepted source bundle.",
      );
    }
  }
}

function passed(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.limitExceeded;
}

export async function verifyTaskRegistry(
  buildEvidenceInput: unknown,
  specification: TaskRegistrySpecV1,
  nowUnixSeconds: number,
  options: VerificationOptions = {},
): Promise<VerificationEvidenceV1> {
  let buildEvidence: BuildEvidenceV1;
  try {
    buildEvidence = validateBuildEvidence(
      buildEvidenceInput,
      specification,
      nowUnixSeconds,
    );
  } catch {
    throw new VerifierError(
      "invalid_build_evidence",
      "Verification refused build evidence that does not match its specification.",
    );
  }
  const execute = options.execute ?? executeFixedCommand;
  const workspace = await mkdtemp(join(tmpdir(), "swarmship-verify-"));

  try {
    await writeWorkspace(workspace, buildEvidence);
    const [rustc, cargo, cargoStylus] = await Promise.all([
      runCommand(execute, workspace, "rustc", ["--version"], 30_000),
      runCommand(execute, workspace, "cargo", ["--version"], 30_000),
      runCommand(execute, workspace, "cargo", ["stylus", "--version"], 30_000),
    ]);
    const toolchain: ToolchainEvidence = {
      cargo: normalizeVersion(cargo),
      cargoStylus: normalizeVersion(cargoStylus),
      rustc: normalizeVersion(rustc),
    };
    const toolchainHash = hashVerificationValue(
      "swarmship-toolchain-v1",
      toolchain,
    );
    const checks: VerificationCheck[] = [];
    for (const planned of verificationCheckPlan) {
      const result = await runCommand(
        execute,
        workspace,
        planned.command,
        planned.args,
        planned.timeoutMs,
      );
      checks.push({
        args: [...planned.args],
        command: planned.command,
        exitCode: result.exitCode,
        name: planned.name,
        status: passed(result) ? "passed" : "failed",
      });
      if (!passed(result)) break;
    }

    await assertWorkspaceUnchanged(workspace, buildEvidence);
    let artifactBase64: string | null = null;
    let artifactHash: `0x${string}` | null = null;
    if (
      checks.some(
        (check) => check.name === "wasm_build" && check.status === "passed",
      )
    ) {
      try {
        const artifact = await readFile(
          resolve(
            workspace,
            "target/wasm32-unknown-unknown/release/agent_task_registry.wasm",
          ),
        );
        if (artifact.length < 1 || artifact.length > 500_000) {
          throw new Error("unsafe artifact size");
        }
        artifactBase64 = artifact.toString("base64");
        artifactHash = hashBytes("swarmship-wasm-artifact-v1", artifact);
      } catch {
        artifactBase64 = null;
        artifactHash = null;
      }
    }
    if (artifactHash === null) {
      const wasmBuild = checks.find((check) => check.name === "wasm_build");
      if (wasmBuild?.status === "passed") wasmBuild.status = "failed";
    }
    const status =
      checks.length === verificationCheckPlan.length &&
      checks.every((check) => check.status === "passed")
        ? "passed"
        : "failed";
    const testEvidenceHash = hashVerificationValue(
      "swarmship-verification-checks-v1",
      checks,
    );
    const evidenceRef = hashVerificationValue(
      "swarmship-verification-evidence-v1",
      {
        artifactHash,
        buildEvidenceRef: buildEvidence.evidenceRef,
        status,
        testEvidenceHash,
        toolchainHash,
        version: VERIFICATION_VERSION,
      },
    );
    return {
      artifactBase64,
      artifactHash,
      buildEvidenceRef: buildEvidence.evidenceRef,
      checks,
      evidenceRef,
      status,
      testEvidenceHash,
      toolchain,
      toolchainHash,
      version: VERIFICATION_VERSION,
    };
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}
