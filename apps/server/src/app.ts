import { Hono } from "hono";

import { PRODUCT } from "@swarmship/domain";
import { PersistenceError } from "@swarmship/persistence";

import { registerReleaseRoutes, type ReleaseStore } from "./release-api.js";

export type AppDependencies = {
  releases: ReleaseStore;
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) =>
    context.json({
      product: PRODUCT.name,
      service: "server",
      status: "ready",
    }),
  );
  registerReleaseRoutes(app, dependencies.releases);

  app.onError((error, context) => {
    if (error instanceof PersistenceError) {
      const status = error.code === "idempotency_conflict" ? 409 : 400;
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
