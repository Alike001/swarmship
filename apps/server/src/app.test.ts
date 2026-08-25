import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { ReleaseStore } from "./release-api.js";

function testApp() {
  const releases: ReleaseStore = {
    create: vi.fn(),
    get: vi.fn(),
    listTransitions: vi.fn(),
  };
  return { app: createApp({ releases }), releases };
}

describe("server routes", () => {
  it("returns the real service identity", async () => {
    const response = await testApp().app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      product: "SwarmShip",
      service: "server",
      status: "ready",
    });
  });

  it("does not invent unknown API routes", async () => {
    const response = await testApp().app.request("/api/unknown");
    expect(response.status).toBe(404);
  });

  it("requires JSON content before touching persistence", async () => {
    const { app, releases } = testApp();
    const response = await app.request("/api/releases", {
      method: "POST",
      body: "plain text",
    });

    expect(response.status).toBe(415);
    expect(releases.create).not.toHaveBeenCalled();
  });

  it("requires a safe idempotency key", async () => {
    const { app, releases } = testApp();
    const response = await app.request("/api/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Create one bounded task registry." }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_idempotency_key" },
    });
    expect(releases.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before parsing or persistence", async () => {
    const { app, releases } = testApp();
    const response = await app.request("/api/releases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "request-large",
      },
      body: JSON.stringify({ request: "a".repeat(9_000) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(releases.create).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without exposing parser details", async () => {
    const response = await testApp().app.request("/api/releases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "request-123",
      },
      body: "{broken",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_json",
        message: "The request body must be valid JSON.",
      },
    });
  });

  it("rejects an invalid release identifier before persistence", async () => {
    const { app, releases } = testApp();
    const response = await app.request("/api/releases/not-a-release");

    expect(response.status).toBe(400);
    expect(releases.get).not.toHaveBeenCalled();
  });

  it("does not expose an unexpected persistence error", async () => {
    const get = vi.fn<ReleaseStore["get"]>();
    get.mockRejectedValue(new Error("private database connection details"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const app = createApp({
      releases: {
        create: vi.fn(),
        get,
        listTransitions: vi.fn(),
      },
    });

    const response = await app.request(
      "/api/releases/00000000-0000-4000-8000-000000000000",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "internal_error",
        message: "The release service could not complete this request.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith("Unhandled SwarmShip API error", {
      name: "Error",
    });
    consoleError.mockRestore();
  });
});
