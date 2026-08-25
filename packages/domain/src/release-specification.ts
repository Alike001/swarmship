import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";

import {
  assertCurrentUnixSeconds,
  fieldErrors,
  MAX_SUPPORTED_UNIX_SECONDS,
  type FieldValidationError,
  type ValidationResult,
} from "./validation.js";

export const TASK_REGISTRY_CONTRACT_FAMILY = "agent-task-registry-v1";

const strictAddress = z
  .string({ error: "A checksummed EVM address is required." })
  .refine((value) => isAddress(value, { strict: true }), {
    message: "Use a valid checksummed EVM address.",
  })
  .refine((value) => value !== zeroAddress, {
    message: "The zero address is not allowed.",
  })
  .transform((value) => getAddress(value));

export const taskRegistrySpecSchema = z
  .strictObject({
    contractFamily: z
      .string({ error: "The contract family is required." })
      .refine((value) => value === TASK_REGISTRY_CONTRACT_FAMILY, {
        message: "SwarmShip v1 only supports the agent task registry.",
      })
      .transform(() => TASK_REGISTRY_CONTRACT_FAMILY),
    owner: strictAddress,
    permittedSender: strictAddress,
    permittedReceiver: strictAddress,
    maxHandoffs: z
      .number({ error: "The handoff limit must be a number." })
      .int("The handoff limit must be a whole number.")
      .min(1, "At least one handoff must be allowed."),
    expiry: z
      .number({ error: "The contract expiry must be a Unix timestamp." })
      .int("The contract expiry must be a whole Unix timestamp.")
      .positive("The contract expiry must be after Unix epoch.")
      .max(
        MAX_SUPPORTED_UNIX_SECONDS,
        "The contract expiry must be a readable calendar date.",
      ),
  })
  .refine(
    (specification) =>
      specification.permittedSender !== specification.permittedReceiver,
    {
      path: ["permittedReceiver"],
      message: "The sending and receiving agents must use different addresses.",
    },
  );

export type TaskRegistrySpecV1 = z.infer<typeof taskRegistrySpecSchema>;

export type TaskRegistrySpecSummary = {
  title: string;
  ownership: string;
  permission: string;
  limit: string;
  expiry: string;
};

export function validateTaskRegistrySpec(
  input: unknown,
  nowUnixSeconds: number,
): ValidationResult<TaskRegistrySpecV1> {
  assertCurrentUnixSeconds(nowUnixSeconds);
  const parsed = taskRegistrySpecSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errors: fieldErrors(parsed.error) };
  }

  if (parsed.data.expiry <= nowUnixSeconds) {
    const errors: FieldValidationError[] = [
      {
        field: "expiry",
        message: "The contract permission must expire in the future.",
      },
    ];
    return { success: false, errors };
  }

  return { success: true, data: parsed.data };
}

export function summarizeTaskRegistrySpec(
  specification: TaskRegistrySpecV1,
): TaskRegistrySpecSummary {
  const handoffWord = specification.maxHandoffs === 1 ? "handoff" : "handoffs";

  return {
    title: "Bounded agent task registry",
    ownership: `${specification.owner} owns the deployed registry.`,
    permission: `${specification.permittedSender} may record task handoffs to ${specification.permittedReceiver}.`,
    limit: `The contract accepts at most ${specification.maxHandoffs} ${handoffWord}.`,
    expiry: `The permission ends at ${new Date(specification.expiry * 1_000).toISOString()}.`,
  };
}
