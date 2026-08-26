import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createSwarmShipMcpServer, type McpReleaseService } from "./mcp.js";

async function connectedClient(service: McpReleaseService) {
  const server = createSwarmShipMcpServer(service);
  const client = new Client({ name: "swarmship-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("SwarmShip MCP", () => {
  it("exposes exactly the two bounded release tools", async () => {
    const service: McpReleaseService = {
      inspect: vi.fn(async () => ({ found: false })),
      start: vi.fn(async () => ({ created: true })),
    };
    const { client, server } = await connectedClient(service);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "inspect_swarmship_proof",
      "start_swarmship_release",
    ]);
    await client.close();
    await server.close();
  });

  it("starts a release and returns structured public proof data", async () => {
    const start = vi.fn(async () => ({
      created: true,
      proofUrl: "https://swarmship.vercel.app/?proof=release_test",
    }));
    const service: McpReleaseService = {
      inspect: vi.fn(async () => ({ found: false })),
      start,
    };
    const { client, server } = await connectedClient(service);

    const result = await client.callTool({
      arguments: {
        idempotencyKey: "judge-demo-001",
        request: "Create one bounded registry for approved agent handoffs.",
      },
      name: "start_swarmship_release",
    });

    expect(start).toHaveBeenCalledWith({
      idempotencyKey: "judge-demo-001",
      request: "Create one bounded registry for approved agent handoffs.",
    });
    expect(result.structuredContent).toMatchObject({ created: true });
    await client.close();
    await server.close();
  });

  it("reads one public proof without private build material", async () => {
    const inspect = vi.fn(async () => ({
      found: true,
      release: { publicId: "release_1234", state: "verified" },
    }));
    const service: McpReleaseService = {
      inspect,
      start: vi.fn(async () => ({ created: true })),
    };
    const { client, server } = await connectedClient(service);

    const result = await client.callTool({
      arguments: { publicId: "release_12341234123412341234123412341234" },
      name: "inspect_swarmship_proof",
    });

    expect(inspect).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({
      found: true,
      release: { state: "verified" },
    });
    expect(JSON.stringify(result)).not.toContain("private source");
    await client.close();
    await server.close();
  });
});
