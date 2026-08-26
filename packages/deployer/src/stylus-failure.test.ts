import { describe, expect, it } from "vitest";

import {
  classifyStylusDeploymentFailure,
  classifyStylusVerificationFailure,
} from "./stylus-command.js";

describe("Stylus deployment failure classification", () => {
  it.each([
    ["not enough funds in account", "insufficient_funds"],
    ["invalid constructor: mismatch", "constructor_invalid"],
    ["deploy tx reverted 0x1234", "transaction_reverted"],
    ["rpc error: connection reset", "rpc_unavailable"],
    ["unrecognized safe failure", "command_failed"],
  ] as const)("classifies %s", (output, reason) => {
    expect(classifyStylusDeploymentFailure(output, false, false)).toEqual({
      reason,
      status: "unknown",
    });
  });

  it("prioritizes bounded execution failures", () => {
    expect(classifyStylusDeploymentFailure("", true, false)).toEqual({
      reason: "command_timed_out",
      status: "unknown",
    });
    expect(classifyStylusDeploymentFailure("", false, true)).toEqual({
      reason: "output_limit_exceeded",
      status: "unknown",
    });
  });
});

describe("Stylus verification failure classification", () => {
  it("distinguishes a byte mismatch from transport and execution failures", () => {
    expect(
      classifyStylusVerificationFailure(
        "Verification failed: Contract { build_wasm_length: 10 }",
        false,
        false,
      ),
    ).toEqual({ reason: "artifact_mismatch", status: "failed" });
    expect(
      classifyStylusVerificationFailure("rpc error", false, false),
    ).toEqual({ reason: "rpc_unavailable", status: "failed" });
    expect(classifyStylusVerificationFailure("", true, false)).toEqual({
      reason: "command_timed_out",
      status: "failed",
    });
  });
});
