import { describe, expect, it } from "vitest";

import { classifyModelProviderError } from "./provider-error.js";

describe("model provider error classification", () => {
  it.each([
    [{ status: 401, code: "invalid_api_key" }, "model_authentication_failed"],
    [{ status: 429, code: "insufficient_quota" }, "model_quota_exhausted"],
    [{ status: 429, code: "rate_limit_exceeded" }, "model_rate_limited"],
    [{ status: 403, code: "model_not_found" }, "model_access_denied"],
    [{ message: "fetch failed" }, "model_transport_unavailable"],
    [new Error("unclassified provider failure"), "model_unavailable"],
  ] as const)("classifies %o as %s", (error, code) => {
    expect(classifyModelProviderError("build", error).code).toBe(code);
  });

  it("reads a safe code from a wrapped cause", () => {
    expect(
      classifyModelProviderError("build", {
        cause: { status: 429, code: "insufficient_quota" },
      }).code,
    ).toBe("model_quota_exhausted");
  });
});
