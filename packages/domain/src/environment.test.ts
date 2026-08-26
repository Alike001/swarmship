import { describe, expect, it } from "vitest";

import {
  parseServerEnvironment,
  parseWorkerChainEnvironment,
  parseWorkerEnvironment,
} from "./environment.js";

describe("environment validation", () => {
  it("uses safe local defaults", () => {
    expect(parseServerEnvironment({})).toEqual({
      DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres",
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      PORT: 3_000,
    });
    expect(parseWorkerEnvironment({})).toEqual({
      DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres",
      NODE_ENV: "development",
      WORKER_LEASE_SECONDS: 60,
      WORKER_POLL_INTERVAL_MS: 1_000,
      WORKER_RETRY_SECONDS: 300,
    });
  });

  it.each(["0", "65536", "not-a-port"])("rejects invalid port %s", (PORT) => {
    expect(() => parseServerEnvironment({ PORT })).toThrow();
  });

  it.each(["not a URL", "https://database.example.com"])(
    "rejects an invalid database URL %s",
    (DATABASE_URL) => {
      expect(() => parseServerEnvironment({ DATABASE_URL })).toThrow();
    },
  );

  it.each(["0", "249", "60001"])("rejects unsafe poll interval %s", (value) => {
    expect(() =>
      parseWorkerEnvironment({ WORKER_POLL_INTERVAL_MS: value }),
    ).toThrow();
  });

  it.each(["0", "3601"])("rejects unsafe worker duration %s", (value) => {
    expect(() =>
      parseWorkerEnvironment({ WORKER_LEASE_SECONDS: value }),
    ).toThrow();
  });

  it("requires bounded private worker chain credentials", () => {
    const key = `0x${"1".repeat(64)}`;
    expect(
      parseWorkerChainEnvironment({
        ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
        RELAYER_PRIVATE_KEY: key,
      }),
    ).toEqual({
      ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
      RELAYER_PRIVATE_KEY: key,
    });
    expect(() =>
      parseWorkerChainEnvironment({
        ARBITRUM_SEPOLIA_RPC_URL: "file:///tmp/rpc",
        RELAYER_PRIVATE_KEY: "0x1234",
      }),
    ).toThrow();
  });
});
