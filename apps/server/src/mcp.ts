import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import type { ReleaseStore } from "./release-api.js";
import {
  presentRelease,
  presentTransition,
  requestHash,
} from "./release-api.js";

const releaseRequest = z
  .string()
  .trim()
  .min(20)
  .max(2_000)
  .describe("One bounded agent task registry request in plain language.");
const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .describe("A stable safe key to prevent duplicate release creation.");
const publicId = z
  .string()
  .regex(/^release_[a-f0-9]{32}$/)
  .describe("The public SwarmShip proof identifier.");

export type McpReleaseService = {
  inspect(input: { publicId: string }): Promise<Record<string, unknown>>;
  start(input: {
    idempotencyKey: string;
    request: string;
  }): Promise<Record<string, unknown>>;
};

export function createMcpReleaseService(
  releases: ReleaseStore,
): McpReleaseService {
  return {
    async inspect(input) {
      const release = await releases.getByPublicId(input.publicId);
      if (release === null) return { found: false, publicId: input.publicId };
      const transitions = await releases.listTransitions(release.id);
      return {
        found: true,
        proofUrl: `https://swarmship.vercel.app/?proof=${release.publicId}`,
        release: presentRelease(release),
        transitions: transitions.map(presentTransition),
      };
    },
    async start(input) {
      const request = input.request.trim();
      const result = await releases.create({
        idempotency: {
          callerScope: "mcp",
          key: input.idempotencyKey,
          operation: "create_release",
          requestHash: requestHash(request),
        },
        originalRequest: request,
      });
      return {
        created: result.created,
        proofUrl: `https://swarmship.vercel.app/?proof=${result.release.publicId}`,
        release: presentRelease(result.release),
      };
    },
  };
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createSwarmShipMcpServer(service: McpReleaseService) {
  const server = new McpServer({ name: "swarmship", version: "1.0.0" });
  server.registerTool(
    "start_swarmship_release",
    {
      description:
        "Start one bounded five-agent Rust Stylus release. Returns public proof and never approves or deploys without the owner wallet.",
      inputSchema: { idempotencyKey, request: releaseRequest },
      title: "Start SwarmShip release",
    },
    async (input) => toolResult(await service.start(input)),
  );
  server.registerTool(
    "inspect_swarmship_proof",
    {
      description:
        "Read safe public state, agent transitions, hashes, and onchain evidence for one SwarmShip release.",
      inputSchema: { publicId },
      title: "Inspect SwarmShip proof",
    },
    async (input) => toolResult(await service.inspect(input)),
  );
  return server;
}

export function registerMcpRoutes(
  app: Hono,
  service: McpReleaseService,
  webOrigin: string,
): void {
  app.all("/api/mcp", async (context) => {
    const origin = context.req.header("origin");
    if (origin && origin !== webOrigin) {
      return context.json(
        {
          error: { code: -32_000, message: "Untrusted MCP origin." },
          id: null,
          jsonrpc: "2.0",
        },
        403,
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const server = createSwarmShipMcpServer(service);
    await server.connect(transport);
    return transport.handleRequest(context.req.raw);
  });
}
