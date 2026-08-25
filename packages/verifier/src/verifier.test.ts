import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderTaskRegistry } from "@swarmship/builder";
import { describe, expect, it, vi } from "vitest";

import type {
  CommandExecutor,
  CommandRequest,
  CommandResult,
} from "./command-runner.js";
import { validateVerificationEvidence } from "./evidence-validation.js";
import { VerifierError } from "./verification-model.js";
import { verifyTaskRegistry } from "./verifier.js";

const NOW = 1_800_000_000;
const specification = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    limitExceeded: false,
    stderr: "",
    stdout: "ok",
    timedOut: false,
    ...overrides,
  };
}

function successfulExecutor(writeArtifact = true): CommandExecutor {
  return vi.fn(async (request: Readonly<CommandRequest>) => {
    if (request.command === "rustc") {
      return result({ stdout: "rustc 1.96.0 (ac68faa20 2026-05-25)\n" });
    }
    if (request.args[0] === "--version") {
      return result({ stdout: "cargo 1.96.0 (30a34c682 2026-05-25)\n" });
    }
    if (request.args[0] === "stylus" && request.args[1] === "--version") {
      return result({ stdout: "stylus 0.10.9\n" });
    }
    if (writeArtifact && request.args[0] === "build") {
      const artifact = resolve(
        request.cwd,
        "target/wasm32-unknown-unknown/release/agent_task_registry.wasm",
      );
      await mkdir(resolve(artifact, ".."), { recursive: true });
      await writeFile(artifact, Buffer.from("fixed-wasm-artifact"));
    }
    return result();
  });
}

describe("deterministic task registry verification", () => {
  it("runs only the fixed verification plan and returns stable evidence", async () => {
    const build = await renderTaskRegistry(specification, NOW);
    const firstExecutor = successfulExecutor();
    const first = await verifyTaskRegistry(build, specification, NOW, {
      execute: firstExecutor,
    });
    const second = await verifyTaskRegistry(build, specification, NOW, {
      execute: successfulExecutor(),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      buildEvidenceRef: build.evidenceRef,
      status: "passed",
      checks: [
        { name: "rust_format", status: "passed" },
        { name: "rust_tests", status: "passed" },
        { name: "wasm_build", status: "passed" },
        { name: "stylus_check", status: "passed" },
      ],
    });
    expect(first.artifactBase64).not.toBeNull();
    expect(first.artifactHash).toBe(
      "0x8ab520dbc97adc01ac4fa4cb8eb85b3931e5500582dca20326b655046986b8ba",
    );
    expect(first.toolchainHash).toBe(
      "0x44243ccc1221a89bd5a561cf3580489cb67d745854e775e5b9658aad99696747",
    );
    expect(first.testEvidenceHash).toBe(
      "0xd2a7af3e73a81222fec78be2d68e0a9110aa44e85e48e38fc8097404b74e5e4f",
    );
    expect(first.evidenceRef).toBe(
      "0x6d04544c6c2e3a5d47460ad8a4a18373e99922092bf0f4b3bda8df87be3a4fd4",
    );
    expect(firstExecutor).toHaveBeenCalledTimes(7);
    expect(
      (firstExecutor as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => [request.command, request.args],
      ),
    ).toEqual([
      ["rustc", ["--version"]],
      ["cargo", ["--version"]],
      ["cargo", ["stylus", "--version"]],
      ["cargo", ["fmt", "--all", "--", "--check"]],
      ["cargo", ["test", "--locked", "--workspace", "--all-features"]],
      [
        "cargo",
        [
          "build",
          "--locked",
          "--release",
          "--target",
          "wasm32-unknown-unknown",
          "--workspace",
        ],
      ],
      [
        "cargo",
        [
          "stylus",
          "check",
          "--contract",
          "agent-task-registry",
          "--endpoint",
          "https://sepolia-rollup.arbitrum.io/rpc",
        ],
      ],
    ]);
    expect(
      validateVerificationEvidence(first, build, specification, NOW),
    ).toEqual(first);
  });

  it("records a deterministic failure and stops before later commands", async () => {
    const build = await renderTaskRegistry(specification, NOW);
    const base = successfulExecutor();
    const execute: CommandExecutor = vi.fn(async (request) => {
      if (request.args[0] === "test") {
        return result({ exitCode: 101, stderr: "tests failed" });
      }
      return base(request);
    });

    const evidence = await verifyTaskRegistry(build, specification, NOW, {
      execute,
    });

    expect(evidence).toMatchObject({
      artifactBase64: null,
      artifactHash: null,
      status: "failed",
      checks: [
        { name: "rust_format", status: "passed" },
        { name: "rust_tests", status: "failed" },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(5);
    expect(
      validateVerificationEvidence(evidence, build, specification, NOW),
    ).toEqual(evidence);
  });

  it("treats timeout or oversized output as a failed check", async () => {
    const build = await renderTaskRegistry(specification, NOW);
    const base = successfulExecutor();
    const execute: CommandExecutor = vi.fn(async (request) =>
      request.args[0] === "fmt"
        ? result({ exitCode: null, timedOut: true })
        : base(request),
    );

    await expect(
      verifyTaskRegistry(build, specification, NOW, { execute }),
    ).resolves.toMatchObject({
      artifactHash: null,
      status: "failed",
      checks: [{ name: "rust_format", status: "failed" }],
    });
  });

  it("fails the Wasm build check when the artifact is missing", async () => {
    const build = await renderTaskRegistry(specification, NOW);

    const evidence = await verifyTaskRegistry(build, specification, NOW, {
      execute: successfulExecutor(false),
    });

    expect(evidence).toMatchObject({
      artifactHash: null,
      status: "failed",
    });
    expect(evidence.checks).toContainEqual(
      expect.objectContaining({ name: "wasm_build", status: "failed" }),
    );
  });

  it("rejects tampered build or verification evidence", async () => {
    const build = await renderTaskRegistry(specification, NOW);
    const execute = successfulExecutor();
    await expect(
      verifyTaskRegistry(
        { ...build, sourceHash: `0x${"f".repeat(64)}` },
        specification,
        NOW,
        { execute },
      ),
    ).rejects.toMatchObject({
      code: "invalid_build_evidence",
    } satisfies Partial<VerifierError>);
    expect(execute).not.toHaveBeenCalled();

    const evidence = await verifyTaskRegistry(build, specification, NOW, {
      execute: successfulExecutor(),
    });
    expect(() =>
      validateVerificationEvidence(
        {
          ...evidence,
          artifactBase64: Buffer.from("tampered").toString("base64"),
        },
        build,
        specification,
        NOW,
      ),
    ).toThrow("does not match");
    expect(() =>
      validateVerificationEvidence(
        {
          ...evidence,
          checks: evidence.checks.map((check, index) =>
            index === 0 ? { ...check, args: ["test"] } : check,
          ),
        },
        build,
        specification,
        NOW,
      ),
    ).toThrow("does not match");
  });

  it("rejects a command that mutates the accepted source bundle", async () => {
    const build = await renderTaskRegistry(specification, NOW);
    const base = successfulExecutor();
    const execute: CommandExecutor = vi.fn(async (request) => {
      const commandResult = await base(request);
      if (request.args[0] === "fmt") {
        await writeFile(resolve(request.cwd, "Cargo.toml"), "changed");
      }
      return commandResult;
    });

    await expect(
      verifyTaskRegistry(build, specification, NOW, { execute }),
    ).rejects.toMatchObject({
      code: "workspace_invalid",
    } satisfies Partial<VerifierError>);
  });
});
