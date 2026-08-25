import { describe, expect, it } from "vitest";

import { app } from "./app.js";

describe("server health route", () => {
  it("returns the real service identity", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      product: "SwarmShip",
      service: "server",
      status: "ready",
    });
  });

  it("does not invent unknown API routes", async () => {
    const response = await app.request("/api/releases");

    expect(response.status).toBe(404);
  });
});
