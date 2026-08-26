import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { BuildEvidenceV1 } from "@swarmship/builder";

import { VerifierError } from "./verification-model.js";

const ARTIFACT_HASH = /^0x[0-9a-f]{64}$/;

async function populateSourceWorkspace(
  root: string,
  evidence: BuildEvidenceV1,
): Promise<string> {
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
  return canonicalRoot;
}

export function hashWasmArtifact(value: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256")
    .update("swarmship-wasm-artifact-v1")
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

export async function createSourceWorkspace(
  evidence: BuildEvidenceV1,
  prefix = "swarmship-verify-",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await populateSourceWorkspace(root, evidence);
  } catch (error) {
    await removeSourceWorkspace(root);
    throw error;
  }
}

export async function createApprovedSourceWorkspace(
  evidence: BuildEvidenceV1,
  artifactHash: `0x${string}`,
): Promise<string> {
  if (!ARTIFACT_HASH.test(artifactHash)) {
    throw new VerifierError(
      "workspace_invalid",
      "The approved artifact hash cannot identify a stable workspace.",
    );
  }
  const userId = process.getuid?.() ?? 0;
  const base = join(tmpdir(), `swarmship-approved-artifacts-${userId}`);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await chmod(base, 0o700);
  const canonicalBase = await realpath(base);
  const root = join(canonicalBase, artifactHash.slice(2));
  try {
    await mkdir(root, { mode: 0o700 });
  } catch {
    throw new VerifierError(
      "workspace_invalid",
      "This approved artifact already has an active workspace.",
    );
  }
  try {
    return await populateSourceWorkspace(root, evidence);
  } catch (error) {
    await removeSourceWorkspace(root);
    throw error;
  }
}

export async function assertSourceWorkspaceUnchanged(
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

export async function readSourceWorkspaceArtifact(
  root: string,
): Promise<Buffer> {
  const artifact = await readFile(
    resolve(
      root,
      "target/wasm32-unknown-unknown/release/agent_task_registry.wasm",
    ),
  );
  if (artifact.length < 1 || artifact.length > 500_000) {
    throw new VerifierError(
      "workspace_invalid",
      "The rebuilt Wasm artifact has an unsafe size.",
    );
  }
  return artifact;
}

export async function removeSourceWorkspace(root: string): Promise<void> {
  await rm(root, { force: true, recursive: true });
}
