import { describe, expect, it } from "vitest";

import {
  parseServerEnvironment,
  parseWorkerEnvironment,
} from "./environment.js";

describe("environment validation", () => {
  it("uses safe local defaults", () => {
    expect(parseServerEnvironment({})).toEqual({
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      PORT: 3_000,
    });
    expect(parseWorkerEnvironment({})).toEqual({
      NODE_ENV: "development",
      WORKER_POLL_INTERVAL_MS: 1_000,
    });
  });

  it.each(["0", "65536", "not-a-port"])("rejects invalid port %s", (PORT) => {
    expect(() => parseServerEnvironment({ PORT })).toThrow();
  });

  it.each(["0", "249", "60001"])("rejects unsafe poll interval %s", (value) => {
    expect(() =>
      parseWorkerEnvironment({ WORKER_POLL_INTERVAL_MS: value }),
    ).toThrow();
  });
});
