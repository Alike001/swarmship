import {
  createConfiguredAgentModel,
  createSwarmShipAgents,
  runSelectedAgent,
  type AgentToolExecutors,
} from "@swarmship/agents";
import { renderTaskRegistry } from "@swarmship/builder";
import {
  validateVerificationEvidence,
  verifyTaskRegistry,
  type VerificationEvidenceV1,
} from "@swarmship/verifier";

const nowUnixSeconds = 1_800_000_000;
const specification = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
} as const;
const build = await renderTaskRegistry(specification, nowUnixSeconds);
let evidence: VerificationEvidenceV1 | null = null;
let calls = 0;
const unavailableTool = async (): Promise<never> => {
  throw new Error("The live Verification Agent selected a forbidden tool.");
};
const executors: AgentToolExecutors = {
  readIndependentEvidence: unavailableTool,
  renderTaskRegistry: unavailableTool,
  requestGuardedDeployment: unavailableTool,
  runReleaseVerification: async () => {
    calls += 1;
    evidence = await verifyTaskRegistry(build, specification, nowUnixSeconds);
    return {
      checks: evidence.checks.map((check) => `${check.name}:${check.status}`),
      evidenceRef: evidence.evidenceRef,
      status: evidence.status,
    };
  },
};
const configuredModel = createConfiguredAgentModel(process.env, {
  maxRetries: 0,
});
const result = await runSelectedAgent({
  agents: createSwarmShipAgents({
    executors,
    model: configuredModel.model,
  }),
  releaseId: "release_live_verification_smoke",
  snapshot: { state: "building", version: 2, reconciliation: null },
  prompt:
    "Run the fixed Rust and Stylus verification plan for the exact persisted build.",
});
if (result.role !== "verification" || calls !== 1 || evidence === null) {
  throw new Error(
    "The live Verification Agent did not execute exactly one verifier.",
  );
}
const verified = validateVerificationEvidence(
  evidence,
  build,
  specification,
  nowUnixSeconds,
);

console.log(
  JSON.stringify({
    artifactHash: verified.artifactHash,
    checks: verified.checks.map(({ name, status }) => ({ name, status })),
    evidenceRef: verified.evidenceRef,
    model: configuredModel.modelName,
    provider: configuredModel.provider,
    role: result.role,
    summary: result.output.summary,
    testEvidenceHash: verified.testEvidenceHash,
    toolCalls: calls,
    toolStatus: result.output.toolStatus,
    toolchainHash: verified.toolchainHash,
  }),
);
