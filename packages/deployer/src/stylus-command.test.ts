import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderTaskRegistry } from "@swarmship/builder";
import type { TaskRegistrySpecV1 } from "@swarmship/domain/release";
import {
  VERIFICATION_VERSION,
  hashVerificationValue,
  type CommandExecutor,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";
import { describe, expect, it, vi } from "vitest";

import {
  parseStylusDeploymentOutput,
  runApprovedStylusDeployment,
} from "./stylus-command.js";
import { estimateApprovedStylusDeployment } from "./stylus-estimate.js";

const NOW = 1_800_000_000;
const PRIVATE_KEY = `0x${"1".repeat(64)}` as const;
const ARTIFACT = Buffer.from("approved-wasm");
const ARTIFACT_HASH =
  `0x0a62573d43f192e59e2f24ccb6e3fa71859ccd9418c558c4c5c2c1ae0e722ca7` as const;
const CONTRACT = "0x0000000000000000000000000000000000000004";
const TRANSACTION = `0x${"5".repeat(64)}`;
const SPECIFICATION: TaskRegistrySpecV1 = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

function verification(buildEvidenceRef: `0x${string}`): VerificationEvidenceV1 {
  const checks = [
    ["rust_format", ["fmt", "--all", "--", "--check"]],
    ["rust_tests", ["test", "--locked", "--workspace", "--all-features"]],
    [
      "wasm_build",
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
      "stylus_check",
      [
        "stylus",
        "check",
        "--contract",
        "agent-task-registry",
        "--endpoint",
        "https://sepolia-rollup.arbitrum.io/rpc",
      ],
    ],
  ].map(([name, args]) => ({
    args: args as string[],
    command: "cargo",
    exitCode: 0,
    name: name as VerificationEvidenceV1["checks"][number]["name"],
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
    artifactBase64: ARTIFACT.toString("base64"),
    artifactHash: ARTIFACT_HASH,
    buildEvidenceRef,
    checks,
    evidenceRef: hashVerificationValue("swarmship-verification-evidence-v1", {
      artifactHash: ARTIFACT_HASH,
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

describe("Stylus deployment command", () => {
  it("parses exactly one pair of official output markers", () => {
    expect(
      parseStylusDeploymentOutput(
        `deployed code at address: "${CONTRACT}"\ndeployment tx hash: "${TRANSACTION}"`,
      ),
    ).toEqual({
      contractAddress: CONTRACT,
      status: "observed",
      transactionHash: TRANSACTION,
    });
    expect(
      parseStylusDeploymentOutput(
        `INFO deployed code at address: ${CONTRACT}\ndeployed code at address: ${CONTRACT}\ndeployment tx hash: ${TRANSACTION}`,
      ),
    ).toMatchObject({ status: "observed" });
    expect(
      parseStylusDeploymentOutput(
        `deployed code at address: ${CONTRACT}\ndeployed code at address: 0x0000000000000000000000000000000000000006\ndeployment tx hash: ${TRANSACTION}`,
      ),
    ).toEqual({ status: "unknown", reason: "output_invalid" });
  });

  it("uses a private key file and fixed constructor values", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    let keyPath = "";
    const execute = vi.fn<CommandExecutor>(async (request) => {
      if (request.args[0] === "build") {
        const target = resolve(
          request.cwd,
          "target/wasm32-unknown-unknown/release",
        );
        await mkdir(target, { recursive: true });
        await writeFile(resolve(target, "agent_task_registry.wasm"), ARTIFACT);
        return {
          exitCode: 0,
          limitExceeded: false,
          stderr: "",
          stdout: "built",
          timedOut: false,
        };
      }
      const keyIndex = request.args.indexOf("--private-key-path");
      keyPath = request.args[keyIndex + 1] ?? "";
      expect(request.args).not.toContain(PRIVATE_KEY);
      expect(await readFile(keyPath, "utf8")).toBe(PRIVATE_KEY);
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      expect(request.args.slice(-6)).toEqual([
        "--constructor-args",
        SPECIFICATION.owner,
        SPECIFICATION.permittedSender,
        SPECIFICATION.permittedReceiver,
        String(SPECIFICATION.maxHandoffs),
        String(SPECIFICATION.expiry),
      ]);
      return {
        exitCode: 0,
        limitExceeded: false,
        stderr: "",
        stdout: `deployed code at address: ${CONTRACT}\ndeployment tx hash: ${TRANSACTION}`,
        timedOut: false,
      };
    });

    await expect(
      runApprovedStylusDeployment({
        buildEvidence: build,
        execute,
        nowUnixSeconds: NOW,
        privateKey: PRIVATE_KEY,
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        specification: SPECIFICATION,
        verificationEvidence: verification(build.evidenceRef),
      }),
    ).resolves.toMatchObject({ status: "observed" });
    await expect(stat(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("estimates the approved deployment without exposing the key", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    let keyPath = "";
    const execute = vi.fn<CommandExecutor>(async (request) => {
      if (request.args[0] === "build") {
        const target = resolve(
          request.cwd,
          "target/wasm32-unknown-unknown/release",
        );
        await mkdir(target, { recursive: true });
        await writeFile(resolve(target, "agent_task_registry.wasm"), ARTIFACT);
        return {
          exitCode: 0,
          limitExceeded: false,
          stderr: "",
          stdout: "built",
          timedOut: false,
        };
      }
      expect(request.args).toContain("--estimate-gas");
      expect(request.args).not.toContain(PRIVATE_KEY);
      const keyIndex = request.args.indexOf("--private-key-path");
      keyPath = request.args[keyIndex + 1] ?? "";
      expect(await readFile(keyPath, "utf8")).toBe(PRIVATE_KEY);
      return {
        exitCode: 0,
        limitExceeded: false,
        stderr: "",
        stdout: [
          'wasm data fee: "0.000110 ETH" (originally "0.000092 ETH" with 20% bump)',
          "deployment tx gas: 1234567",
          'gas price: "0.01" gwei',
          'deployment tx total cost: "0.00001234567" ETH',
        ].join("\n"),
        timedOut: false,
      };
    });

    await expect(
      estimateApprovedStylusDeployment({
        buildEvidence: build,
        execute,
        nowUnixSeconds: NOW,
        privateKey: PRIVATE_KEY,
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        specification: SPECIFICATION,
        verificationEvidence: verification(build.evidenceRef),
      }),
    ).resolves.toEqual({
      dataFeeEth: "0.000110",
      gasPriceGwei: "0.01",
      reportedGasWithMixedUnits: "1234567",
      reportedTotalCostEthWithMixedUnits: "0.00001234567",
      status: "estimated",
      warning: "cargo_stylus_0_10_9_mixed_wei_into_gas",
    });
    await expect(stat(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("classifies an insufficient estimate without returning command output", async () => {
    const build = await renderTaskRegistry(SPECIFICATION, NOW);
    const execute = vi.fn<CommandExecutor>(async (request) => {
      if (request.args[0] === "build") {
        const target = resolve(
          request.cwd,
          "target/wasm32-unknown-unknown/release",
        );
        await mkdir(target, { recursive: true });
        await writeFile(resolve(target, "agent_task_registry.wasm"), ARTIFACT);
        return {
          exitCode: 0,
          limitExceeded: false,
          stderr: "",
          stdout: "built",
          timedOut: false,
        };
      }
      return {
        exitCode: 1,
        limitExceeded: false,
        stderr: "insufficient funds for gas * price + value",
        stdout: "",
        timedOut: false,
      };
    });

    await expect(
      estimateApprovedStylusDeployment({
        buildEvidence: build,
        execute,
        nowUnixSeconds: NOW,
        privateKey: PRIVATE_KEY,
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        specification: SPECIFICATION,
        verificationEvidence: verification(build.evidenceRef),
      }),
    ).resolves.toEqual({ status: "failed", reason: "insufficient_funds" });
  });
});
