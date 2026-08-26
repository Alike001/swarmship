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
import {
  assertSourceWorkspaceUnchanged,
  createSourceWorkspace,
  hashWasmArtifact,
  readSourceWorkspaceArtifact,
  removeSourceWorkspace,
} from "./source-workspace.js";

export type VerificationOptions = {
  execute?: CommandExecutor;
};

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
  const workspace = await createSourceWorkspace(buildEvidence);

  try {
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

    await assertSourceWorkspaceUnchanged(workspace, buildEvidence);
    let artifactBase64: string | null = null;
    let artifactHash: `0x${string}` | null = null;
    if (
      checks.some(
        (check) => check.name === "wasm_build" && check.status === "passed",
      )
    ) {
      try {
        const artifact = await readSourceWorkspaceArtifact(workspace);
        artifactBase64 = artifact.toString("base64");
        artifactHash = hashWasmArtifact(artifact);
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
    await removeSourceWorkspace(workspace);
  }
}
