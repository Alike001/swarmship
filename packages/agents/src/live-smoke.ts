import {
  createSwarmShipAgents,
  createConfiguredAgentModel,
  extractAcceptedSpecification,
  runSelectedAgent,
  type AgentToolExecutors,
} from "./index.js";

const forbiddenExecutor = async (): Promise<never> => {
  throw new Error("The live Specification Agent smoke must not call a tool.");
};
const executors: AgentToolExecutors = {
  renderTaskRegistry: forbiddenExecutor,
  runReleaseVerification: forbiddenExecutor,
  requestGuardedDeployment: forbiddenExecutor,
  readIndependentEvidence: forbiddenExecutor,
};
const configuredModel = createConfiguredAgentModel(process.env, {
  maxRetries: 0,
});
const agents = createSwarmShipAgents({
  model: configuredModel.model,
  executors,
});
const snapshot = {
  state: "created",
  version: 0,
  reconciliation: null,
} as const;
const result = await runSelectedAgent({
  agents,
  releaseId: "release_live_specification_smoke",
  snapshot,
  prompt: `Create the fixed SwarmShip agent task registry with owner 0x0000000000000000000000000000000000000001, permitted sender 0x0000000000000000000000000000000000000002, permitted receiver 0x0000000000000000000000000000000000000003, a maximum of 5 handoffs, and Unix expiry 2000000000.`,
});
if (result.role !== "specification") {
  throw new Error("The live smoke selected the wrong agent role.");
}
const specification = extractAcceptedSpecification(
  result.output,
  Math.floor(Date.now() / 1_000),
);

console.log(
  JSON.stringify({
    contractFamily: specification.contractFamily,
    decision: result.output.decision,
    maxHandoffs: specification.maxHandoffs,
    model: configuredModel.modelName,
    provider: configuredModel.provider,
    role: result.role,
    summary: result.output.summary,
    toolCalls: 0,
  }),
);
