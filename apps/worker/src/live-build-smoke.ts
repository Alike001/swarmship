import type { Model } from "@openai/agents";
import {
  createConfiguredAgentModel,
  createSwarmShipAgents,
  buildToolResultSchema,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import { renderTaskRegistry } from "@swarmship/builder";

const nowUnixSeconds = 1_800_000_000;
const specification = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
} as const;
let calls = 0;
const unavailableTool = async (): Promise<never> => {
  throw new Error("The live Build Agent smoke selected a forbidden tool.");
};
const executors: AgentToolExecutors = {
  readIndependentEvidence: unavailableTool,
  requestGuardedDeployment: unavailableTool,
  runReleaseVerification: unavailableTool,
  renderTaskRegistry: async () => {
    calls += 1;
    const evidence = await renderTaskRegistry(specification, nowUnixSeconds);
    return {
      status: "rendered",
      evidenceRef: evidence.evidenceRef,
      sourceHash: evidence.sourceHash,
      testInputHash: evidence.testInputHash,
    };
  },
};
const configuredModel = createConfiguredAgentModel(process.env, {
  maxRetries: 0,
});
const baseModel = configuredModel.model;
const model: Model = {
  getResponse: async (request) => {
    try {
      return await baseModel.getResponse(request);
    } catch (error) {
      const metadata = error as {
        code?: unknown;
        name?: unknown;
        status?: unknown;
      };
      console.error(
        JSON.stringify({
          providerError: {
            code: typeof metadata.code === "string" ? metadata.code : null,
            name: typeof metadata.name === "string" ? metadata.name : null,
            status:
              typeof metadata.status === "number" ? metadata.status : null,
          },
        }),
      );
      throw error;
    }
  },
  getStreamedResponse: (request) => baseModel.getStreamedResponse(request),
};
const agents = createSwarmShipAgents({
  executors,
  model,
});
const result = await runSelectedAgent({
  agents,
  releaseId: "release_live_build_smoke",
  snapshot: { state: "specified", version: 1, reconciliation: null },
  prompt:
    "Render the accepted fixed task registry and its deterministic test inputs.",
});
if (result.role !== "build" || calls !== 1) {
  throw new Error("The live Build Agent did not execute exactly one renderer.");
}
const toolResult = buildToolResultSchema.parse(result.toolRecord.result);

console.log(
  JSON.stringify({
    evidenceRef: toolResult.evidenceRef,
    model: configuredModel.modelName,
    provider: configuredModel.provider,
    role: result.role,
    sourceHash: toolResult.sourceHash,
    summary: result.output.summary,
    testInputHash: toolResult.testInputHash,
    toolCalls: calls,
    toolStatus: result.output.toolStatus,
  }),
);
