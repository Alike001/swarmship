import { describe, expect, it } from "vitest";

import { getWorkerHealth } from "./health.js";

describe("worker health", () => {
  it("reports the configured poll interval", () => {
    expect(getWorkerHealth({ WORKER_POLL_INTERVAL_MS: 750 })).toEqual({
      pollIntervalMs: 750,
      service: "worker",
      status: "ready",
    });
  });
});
