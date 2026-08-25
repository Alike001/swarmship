import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSwarmShipAgents,
  type AgentToolExecutors,
} from "@swarmship/agents";
import {
  closeDatabase,
  createDatabase,
  LeaseRepository,
  ReleaseRepository,
  runMigrations,
  SpecificationRepository,
  type Database,
} from "@swarmship/persistence";

import { processOneSpecification } from "./specification-processor.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:55432/postgres";
const schema = "swarmship_worker_test";
const acceptedOutput = {
  decision: "accepted",
  summary: "A five-use registry for two approved agents.",
  missingFields: [],
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
} as const;
let adminDatabase: Database;
let testDatabase: Database;
let leases: LeaseRepository;
let releases: ReleaseRepository;
let specifications: SpecificationRepository;

const unavailableTool = async (): Promise<never> => {
  throw new Error("Specification tests cannot call tools.");
};
const executors: AgentToolExecutors = {
  readIndependentEvidence: unavailableTool,
  renderTaskRegistry: unavailableTool,
  requestGuardedDeployment: unavailableTool,
  runReleaseVerification: unavailableTool,
};

function scriptedModel(output: unknown): ScriptedModel {
  const message = {
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [{ type: "output_text" as const, text: JSON.stringify(output) }],
  };
  const response: ModelResponse = { output: [message], usage: new Usage() };
  return new ScriptedModel([response]);
}

function dependencies(model: Model, workerId: string) {
  return {
    agents: createSwarmShipAgents({ executors, model }),
    leaseSeconds: 60,
    leases,
    nowUnixSeconds: () => 1_900_000_000,
    retrySeconds: 300,
    specifications,
    workerId,
  };
}

beforeAll(async () => {
  adminDatabase = createDatabase(databaseUrl);
  await adminDatabase`DROP SCHEMA IF EXISTS ${adminDatabase(schema)} CASCADE`;
  await adminDatabase`CREATE SCHEMA ${adminDatabase(schema)}`;
  testDatabase = createDatabase(databaseUrl, { searchPath: schema });
  await runMigrations(testDatabase);
  leases = new LeaseRepository(testDatabase);
  releases = new ReleaseRepository(testDatabase);
  specifications = new SpecificationRepository(testDatabase);
});

beforeEach(async () => {
  await testDatabase`
    TRUNCATE idempotency_keys, chain_events, release_transitions, releases
    RESTART IDENTITY CASCADE
  `;
});

afterAll(async () => {
  await closeDatabase(testDatabase);
  await adminDatabase`DROP SCHEMA IF EXISTS ${adminDatabase(schema)} CASCADE`;
  await closeDatabase(adminDatabase);
});

describe("leased Specification Agent processing", () => {
  it("persists an accepted SDK result and its canonical transition", async () => {
    const created = await releases.create({
      originalRequest: "Complete registry",
    });

    await expect(
      processOneSpecification(
        dependencies(scriptedModel(acceptedOutput), "worker-a"),
      ),
    ).resolves.toMatchObject({
      decision: "accepted",
      releaseId: created.release.id,
      status: "processed",
    });
    expect(await releases.get(created.release.id)).toMatchObject({
      missingFields: [],
      specification: { maxHandoffs: 5 },
      state: "specified",
      version: 1,
    });
    expect(await releases.listTransitions(created.release.id)).toHaveLength(1);
  });

  it("persists missing fields and waits for the user", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const output = {
      ...acceptedOutput,
      decision: "needs_input",
      missingFields: ["owner"],
      owner: null,
      summary: "The owner address is missing.",
    } as const;

    await processOneSpecification(
      dependencies(scriptedModel(output), "worker-a"),
    );

    expect(await releases.get(created.release.id)).toMatchObject({
      missingFields: ["owner"],
      specification: null,
      state: "needs_input",
    });
    expect(await leases.claimNext("worker-b", 60, ["created"])).toBeNull();
  });

  it("defers malformed model output without advancing state", async () => {
    const created = await releases.create({ originalRequest: "Registry" });

    const result = await processOneSpecification(
      dependencies(scriptedModel({ decision: "accepted" }), "worker-a"),
    );

    expect(result).toMatchObject({
      code: "invalid_model_output",
      status: "deferred",
    });
    expect(await releases.get(created.release.id)).toMatchObject({
      retryCount: 1,
      safeError: { code: "invalid_model_output" },
      state: "created",
      version: 0,
    });
    expect(await releases.listTransitions(created.release.id)).toHaveLength(0);
  });

  it("allows only one of two workers to process a release", async () => {
    await releases.create({ originalRequest: "Complete registry" });
    const results = await Promise.all([
      processOneSpecification(dependencies(scriptedModel(acceptedOutput), "a")),
      processOneSpecification(dependencies(scriptedModel(acceptedOutput), "b")),
    ]);

    expect(
      results.filter((result) => result.status === "processed"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === "idle")).toHaveLength(
      1,
    );
  });
});
