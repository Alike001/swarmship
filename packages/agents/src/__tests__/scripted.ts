import { Usage, type ModelResponse } from "@openai/agents";

export function scriptedAssistantMessage(text: string) {
  return {
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [{ type: "output_text" as const, text }],
  };
}

export function scriptedFunctionCall(name: string, callId: string) {
  return {
    type: "function_call" as const,
    callId,
    name,
    status: "completed" as const,
    arguments: "{}",
  };
}

export function scriptedResponse(
  ...output: ModelResponse["output"]
): ModelResponse {
  return { usage: new Usage(), output };
}
