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

import type { StylusEstimateResult } from "./deployment-model.js";

const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);

type ApprovedEstimateInput = {
  buildEvidence: BuildEvidenceV1;
  execute?: CommandExecutor;
  nowUnixSeconds: number;
  privateKey: `0x${string}`;
  rpcUrl: string;
  specification: TaskRegistrySpecV1;
  verificationEvidence: VerificationEvidenceV1;
};

function cleanOutput(output: string): string {
  return output.replaceAll(ANSI_ESCAPE, "");
}

function estimateFailure(
  output: string,
  timedOut: boolean,
): Extract<StylusEstimateResult, { status: "failed" }> {
  if (timedOut) return { status: "failed", reason: "command_timed_out" };
  const value = cleanOutput(output).toLowerCase();
  if (
    value.includes("insufficient funds") ||
    value.includes("not enough funds")
  ) {
    return { status: "failed", reason: "insufficient_funds" };
  }
  if (value.includes("constructor")) {
    return { status: "failed", reason: "constructor_invalid" };
  }
  if (
    value.includes("transport") ||
    value.includes("connection") ||
    value.includes("rpc")
  ) {
    return { status: "failed", reason: "rpc_unavailable" };
  }
  return { status: "failed", reason: "command_failed" };
}

function estimateValue(
  output: string,
  label: string,
  suffix = "",
): string | null {
  const line = cleanOutput(output)
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(label));
  if (line === undefined) return null;
  const value = line.slice(label.length).trim().replace(/^"|"$/g, "");
  return suffix !== "" && value.toLowerCase().endsWith(suffix.toLowerCase())
    ? value.slice(0, -suffix.length).trim().replace(/^"|"$/g, "")
    : value;
}

function dataFeeValue(output: string): string | null {
  const match = /wasm data fee:\s*"?([0-9]+(?:\.[0-9]+)?)\s+ETH"?/i.exec(
    cleanOutput(output),
  );
  return match?.[1] ?? null;
}

export async function estimateApprovedStylusDeployment(
  input: ApprovedEstimateInput,
): Promise<StylusEstimateResult> {
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
        "--estimate-gas",
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
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0 || result.timedOut || result.limitExceeded) {
      return estimateFailure(output, result.timedOut);
    }
    const reportedGasWithMixedUnits = estimateValue(
      output,
      "deployment tx gas:",
    );
    const gasPriceGwei = estimateValue(output, "gas price:", "gwei");
    const reportedTotalCostEthWithMixedUnits = estimateValue(
      output,
      "deployment tx total cost:",
      "ETH",
    );
    const dataFeeEth = dataFeeValue(output);
    return reportedGasWithMixedUnits !== null &&
      gasPriceGwei !== null &&
      reportedTotalCostEthWithMixedUnits !== null &&
      dataFeeEth !== null
      ? {
          dataFeeEth,
          gasPriceGwei,
          reportedGasWithMixedUnits,
          reportedTotalCostEthWithMixedUnits,
          status: "estimated",
          warning: "cargo_stylus_0_10_9_mixed_wei_into_gas",
        }
      : { status: "failed", reason: "output_invalid" };
  } finally {
    await removeSourceWorkspace(workspace.root);
    if (keyDirectory !== null) {
      await rm(keyDirectory, { force: true, recursive: true });
    }
  }
}
