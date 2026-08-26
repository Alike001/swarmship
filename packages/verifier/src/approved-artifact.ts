import {
  validateBuildEvidence,
  type BuildEvidenceV1,
} from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";

import {
  executeFixedCommand,
  type CommandExecutor,
  type CommandResult,
} from "./command-runner.js";
import { validateVerificationEvidence } from "./evidence-validation.js";
import {
  assertSourceWorkspaceUnchanged,
  createApprovedSourceWorkspace,
  hashWasmArtifact,
  readSourceWorkspaceArtifact,
  removeSourceWorkspace,
} from "./source-workspace.js";
import {
  VerifierError,
  type VerificationEvidenceV1,
} from "./verification-model.js";

const BUILD_ARGS = [
  "build",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "--workspace",
] as const;

export type ApprovedArtifactWorkspace = {
  artifactHash: `0x${string}`;
  root: string;
};

async function rebuild(
  execute: CommandExecutor,
  root: string,
): Promise<CommandResult> {
  try {
    return await execute({
      args: BUILD_ARGS,
      command: "cargo",
      cwd: root,
      maxOutputBytes: 96_000,
      timeoutMs: 300_000,
    });
  } catch {
    throw new VerifierError(
      "command_unavailable",
      "The approved artifact rebuild could not be started.",
    );
  }
}

export async function reconstructApprovedArtifact(
  buildInput: unknown,
  verificationInput: unknown,
  specification: TaskRegistrySpecV1,
  nowUnixSeconds: number,
  execute: CommandExecutor = executeFixedCommand,
): Promise<ApprovedArtifactWorkspace> {
  const build: BuildEvidenceV1 = validateBuildEvidence(
    buildInput,
    specification,
    nowUnixSeconds,
  );
  const verification: VerificationEvidenceV1 = validateVerificationEvidence(
    verificationInput,
    build,
    specification,
    nowUnixSeconds,
  );
  if (
    verification.status !== "passed" ||
    verification.artifactHash === null ||
    verification.artifactBase64 === null
  ) {
    throw new VerifierError(
      "invalid_build_evidence",
      "Deployment requires complete passing verification evidence.",
    );
  }

  const root = await createApprovedSourceWorkspace(
    build,
    verification.artifactHash,
  );
  try {
    const result = await rebuild(execute, root);
    if (result.exitCode !== 0 || result.timedOut || result.limitExceeded) {
      throw new VerifierError(
        "workspace_invalid",
        "The approved deployment artifact could not be rebuilt exactly.",
      );
    }
    await assertSourceWorkspaceUnchanged(root, build);
    const artifact = await readSourceWorkspaceArtifact(root);
    const hash = hashWasmArtifact(artifact);
    if (
      hash !== verification.artifactHash ||
      !artifact.equals(Buffer.from(verification.artifactBase64, "base64"))
    ) {
      throw new VerifierError(
        "workspace_invalid",
        "The rebuilt deployment artifact differs from the approved artifact.",
      );
    }
    return { artifactHash: hash, root };
  } catch (error) {
    await removeSourceWorkspace(root);
    throw error;
  }
}

export { removeSourceWorkspace };
