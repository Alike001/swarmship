import { AgentRuntimeError } from "./runtime-error.js";

type ErrorMetadata = {
  status: number | null;
  code: string;
  message: string;
};

function readMetadata(error: unknown, depth = 0): ErrorMetadata {
  if (depth > 2 || error === null || typeof error !== "object") {
    return { status: null, code: "", message: String(error ?? "") };
  }
  const value = error as Record<string, unknown>;
  const statusValue = value.status ?? value.statusCode;
  const own: ErrorMetadata = {
    status: typeof statusValue === "number" ? statusValue : null,
    code: typeof value.code === "string" ? value.code.toLowerCase() : "",
    message:
      typeof value.message === "string" ? value.message.toLowerCase() : "",
  };
  const cause = readMetadata(value.cause, depth + 1);
  return {
    status: own.status ?? cause.status,
    code: own.code || cause.code,
    message: `${own.message} ${cause.message}`.trim(),
  };
}

export function classifyModelProviderError(
  role: string,
  error: unknown,
): AgentRuntimeError {
  const metadata = readMetadata(error);
  if (
    metadata.status === 401 ||
    metadata.code === "invalid_api_key" ||
    metadata.message.includes("invalid api key")
  ) {
    return new AgentRuntimeError(
      "model_authentication_failed",
      "The model provider did not accept the worker credential.",
    );
  }
  if (
    metadata.code === "insufficient_quota" ||
    metadata.message.includes("quota") ||
    metadata.message.includes("credits")
  ) {
    return new AgentRuntimeError(
      "model_quota_exhausted",
      "The model provider account has no available API quota.",
    );
  }
  if (
    metadata.status === 429 ||
    metadata.code === "rate_limit_exceeded" ||
    metadata.message.includes("rate limit")
  ) {
    return new AgentRuntimeError(
      "model_rate_limited",
      "The model provider is rate limiting this release.",
    );
  }
  if (
    metadata.status === 403 ||
    metadata.code === "model_not_found" ||
    metadata.message.includes("does not have access")
  ) {
    return new AgentRuntimeError(
      "model_access_denied",
      "The configured project cannot access the selected model.",
    );
  }
  if (
    metadata.message.includes("fetch failed") ||
    metadata.message.includes("connection") ||
    metadata.message.includes("timeout") ||
    metadata.message.includes("network")
  ) {
    return new AgentRuntimeError(
      "model_transport_unavailable",
      "The worker could not reach the model provider.",
    );
  }
  return new AgentRuntimeError(
    "model_unavailable",
    `The ${role} agent could not complete its work.`,
  );
}
