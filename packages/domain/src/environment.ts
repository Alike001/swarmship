import { z } from "zod";
import type { Hex } from "viem";

const port = z.coerce.number().int().min(1).max(65_535);
const pollInterval = z.coerce.number().int().min(250).max(60_000);
const durationSeconds = z.coerce.number().int().min(1).max(3_600);
const databaseUrl = z
  .string()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "Use a PostgreSQL connection URL.",
  );
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Use an HTTP or HTTPS RPC URL.",
  );
const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Use a 32-byte EVM private key.")
  .transform((value) => value as Hex);

const serverEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrl.default(
    "postgres://postgres@127.0.0.1:5432/postgres",
  ),
  HOST: z.string().min(1).default("127.0.0.1"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: port.default(3_000),
});

const workerEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrl.default(
    "postgres://postgres@127.0.0.1:5432/postgres",
  ),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  WORKER_LEASE_SECONDS: durationSeconds.default(60),
  WORKER_POLL_INTERVAL_MS: pollInterval.default(1_000),
  WORKER_RETRY_SECONDS: durationSeconds.default(300),
});

const workerChainEnvironmentSchema = z
  .object({
    ARBITRUM_SEPOLIA_RPC_URL: httpUrl,
    ARBITRUM_SEPOLIA_WITNESS_RPC_URL: httpUrl,
    RELAYER_PRIVATE_KEY: privateKey,
  })
  .superRefine((environment, context) => {
    if (
      environment.ARBITRUM_SEPOLIA_RPC_URL ===
      environment.ARBITRUM_SEPOLIA_WITNESS_RPC_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["ARBITRUM_SEPOLIA_WITNESS_RPC_URL"],
        message: "The witness RPC must be independent from the write RPC.",
      });
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type WorkerChainEnvironment = z.infer<
  typeof workerChainEnvironmentSchema
>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}

export function parseWorkerEnvironment(
  input: Record<string, string | undefined>,
): WorkerEnvironment {
  return workerEnvironmentSchema.parse(input);
}

export function parseWorkerChainEnvironment(
  input: Record<string, string | undefined>,
): WorkerChainEnvironment {
  return workerChainEnvironmentSchema.parse(input);
}
