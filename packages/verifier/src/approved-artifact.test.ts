import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderTaskRegistry } from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import { afterEach, describe, expect, it } from "vitest";

import type { CommandExecutor } from "./command-runner.js";
import {
  reconstructApprovedArtifact,
  removeSourceWorkspace,
} from "./approved-artifact.js";
import { hashWasmArtifact } from "./source-workspace.js";
import {
  VERIFICATION_VERSION,
  hashVerificationValue,
  verificationCheckPlan,
  type VerificationEvidenceV1,
} from "./verification-model.js";

const NOW = 1_800_000_000;
const ARTIFACT = Buffer.from("approved-wasm");
const SPECIFICATION: TaskRegistrySpecV1 = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(removeSourceWorkspace));
});

function evidence(
  buildEvidenceRef: `0x${string}`,
  artifact = ARTIFACT,
): VerificationEvidenceV1 {
  const artifactHash = hashWasmArtifact(artifact);
  const checks = verificationCheckPlan.map((check) => ({
    args: [...check.args],
    command: check.command,
    exitCode: 0,
    name: check.name,
    status: "passed" as const,
  }));
  const toolchain = {
    cargo: "cargo 1.96.0 (30a34c682 2026-05-25)",
    cargoStylus: "stylus 0.10.9",
    rustc: "rustc 1.96.0 (ac68faa20 2026-05-25)",
  };
  const toolchainHash = hashVerificationValue(
    "swarmship-toolchain-v1",
    toolchain,
  );
  const testEvidenceHash = hashVerificationValue(
    "swarmship-verification-checks-v1",
    checks,
  );
  return {
    artifactBase64: artifact.toString("base64"),
    artifactHash,
    buildEvidenceRef,
    checks,
    evidenceRef: hashVerificationValue("swarmship-verification-evidence-v1", {
      artifactHash,
      buildEvidenceRef,
      status: "passed",
      testEvidenceHash,
      toolchainHash,
      version: VERIFICATION_VERSION,
    }),
    status: "passed",
    testEvidenceHash,
    toolchain,
    toolchainHash,
    version: VERIFICATION_VERSION,
  };
}

function executor(artifact = ARTIFACT): CommandExecutor {
  return async (request) => {
    const target = resolve(
      request.cwd,
      "target/wasm32-unknown-unknown/release",
    );
    await mkdir(target, { recursive: true });
    await writeFile(resolve(target, "agent_task_registry.wasm"), artifact);
    return {
      exitCode: 0,
      limitExceeded: false,
      stderr: "",
      stdout: "Finished release build",
      timedOut: false,
    };
  };
}

describe("approved deployment artifact reconstruction", () => {
  it("rebuilds the accepted source in an owner-only workspace", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    const result = await reconstructApprovedArtifact(
      build,
      evidence(build.evidenceRef),
      SPECIFICATION,
      NOW,
      executor(),
    );
    workspaces.push(result.root);

    expect(result.artifactHash).toBe(hashWasmArtifact(ARTIFACT));
    expect((await stat(result.root)).mode & 0o777).toBe(0o700);
  });

  it("reuses one absolute path for the same artifact across reconstructions", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    const first = await reconstructApprovedArtifact(
      build,
      evidence(build.evidenceRef),
      SPECIFICATION,
      NOW,
      executor(),
    );
    const firstRoot = first.root;
    await removeSourceWorkspace(first.root);
    const second = await reconstructApprovedArtifact(
      build,
      evidence(build.evidenceRef),
      SPECIFICATION,
      NOW,
      executor(),
    );
    workspaces.push(second.root);

    expect(second.root).toBe(firstRoot);
  });

  it("refuses concurrent use of one approved artifact workspace", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    const first = await reconstructApprovedArtifact(
      build,
      evidence(build.evidenceRef),
      SPECIFICATION,
      NOW,
      executor(),
    );
    workspaces.push(first.root);

    await expect(
      reconstructApprovedArtifact(
        build,
        evidence(build.evidenceRef),
        SPECIFICATION,
        NOW,
        executor(),
      ),
    ).rejects.toMatchObject({ code: "workspace_invalid" });
  });

  it("removes the workspace when rebuilt bytes differ", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);

    await expect(
      reconstructApprovedArtifact(
        build,
        evidence(build.evidenceRef),
        SPECIFICATION,
        NOW,
        executor(Buffer.from("changed-wasm")),
      ),
    ).rejects.toMatchObject({ code: "workspace_invalid" });
  });
});
