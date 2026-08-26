export type AgentRuntimeErrorCode =
  | "invalid_snapshot"
  | "wait_for_user"
  | "terminal_state"
  | "invalid_model_output"
  | "model_authentication_failed"
  | "model_quota_exhausted"
  | "model_rate_limited"
  | "model_access_denied"
  | "model_transport_unavailable"
  | "model_unavailable"
  | "invalid_tool_execution"
  | "transition_rejected";

export class AgentRuntimeError extends Error {
  constructor(
    readonly code: AgentRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}
