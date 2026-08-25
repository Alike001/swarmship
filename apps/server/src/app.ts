import { Hono } from "hono";

import { PRODUCT } from "@swarmship/domain";

export const app = new Hono().get("/api/health", (context) =>
  context.json({
    product: PRODUCT.name,
    service: "server",
    status: "ready",
  }),
);

export type App = typeof app;
