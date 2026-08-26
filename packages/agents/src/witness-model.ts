import {
  Usage,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";

import { AGENT_TOOL_NAMES } from "./tools.js";

export class WitnessToolRouterModel implements Model {
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const witnessTool = request.tools.find(
      (candidate) => candidate.name === AGENT_TOOL_NAMES.witness,
    );
    if (witnessTool === undefined)
      throw new Error("The Witness tool is unavailable.");

    return {
      output: [
        {
          arguments: "{}",
          callId: `witness-${request.input.length}`,
          name: AGENT_TOOL_NAMES.witness,
          status: "completed",
          type: "function_call",
        },
      ],
      usage: new Usage(),
    };
  }

  getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<StreamEvent>> => {
            throw new Error("The Witness router does not support streaming.");
          },
        };
      },
    };
  }
}
