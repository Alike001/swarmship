import { Hono } from "hono";
import { cors } from "hono/cors";

import { PRODUCT } from "@swarmship/domain";
import type { PersistenceErrorCode } from "@swarmship/persistence";

import { registerApprovalRoutes, type ApprovalStore } from "./approval-api.js";
import { createMcpReleaseService, registerMcpRoutes } from "./mcp.js";
import { registerReleaseRoutes, type ReleaseStore } from "./release-api.js";

export type AppDependencies = {
  approvals: ApprovalStore;
  releases: ReleaseStore;
  webOrigin?: string;
};

const persistenceErrorCodes: readonly PersistenceErrorCode[] = [
  "approval_conflict",
  "idempotency_conflict",
  "release_not_found",
  "transition_rejected",
  "transition_conflict",
  "lease_lost",
];

function isPersistenceError(
  error: Error,
): error is Error & { code: PersistenceErrorCode } {
  if (error.name !== "PersistenceError" || !("code" in error)) return false;
  return persistenceErrorCodes.includes(
    (error as Error & { code: PersistenceErrorCode }).code,
  );
}

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();
  const webOrigin = dependencies.webOrigin ?? "http://127.0.0.1:4318";

  app.use(
    "/api/*",
    cors({
      allowHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "Last-Event-ID",
        "Mcp-Protocol-Version",
        "Mcp-Session-Id",
      ],
      allowMethods: ["DELETE", "GET", "POST", "OPTIONS"],
      exposeHeaders: ["Location", "Mcp-Protocol-Version", "Mcp-Session-Id"],
      maxAge: 600,
      origin: (origin) => (origin === webOrigin ? origin : ""),
    }),
  );

  app.get("/api/health", (context) =>
    context.json({
      product: PRODUCT.name,
      service: "server",
      status: "ready",
    }),
  );
  registerReleaseRoutes(app, dependencies.releases);
  registerApprovalRoutes(app, dependencies.approvals);
  registerMcpRoutes(
    app,
    createMcpReleaseService(dependencies.releases),
    webOrigin,
  );

  app.onError((error, context) => {
    if (isPersistenceError(error)) {
      const status =
        error.code === "release_not_found"
          ? 404
          : error.code === "idempotency_conflict" ||
              error.code === "approval_conflict" ||
              error.code === "transition_conflict"
            ? 409
            : 400;
      return context.json(
        { error: { code: error.code, message: error.message } },
        status,
      );
    }

    console.error("Unhandled SwarmShip API error", { name: error.name });
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "The release service could not complete this request.",
        },
      },
      500,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
