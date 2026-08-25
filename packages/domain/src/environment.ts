import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65_535);
const pollInterval = z.coerce.number().int().min(250).max(60_000);

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "Use a PostgreSQL connection URL.",
    )
    .default("postgres://postgres@127.0.0.1:5432/postgres"),
  HOST: z.string().min(1).default("127.0.0.1"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: port.default(3_000),
});

const workerEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  WORKER_POLL_INTERVAL_MS: pollInterval.default(1_000),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

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
