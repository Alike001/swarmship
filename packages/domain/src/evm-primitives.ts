import type { Hex } from "viem";
import { z } from "zod";

const ZERO_BYTES_32 = `0x${"0".repeat(64)}`;

export const nonZeroBytes32Schema = z
  .string({ error: "A 32-byte value is required." })
  .regex(/^0x[0-9a-fA-F]{64}$/, "Use a 0x-prefixed 32-byte hexadecimal value.")
  .refine((value) => value.toLowerCase() !== ZERO_BYTES_32, {
    message: "The zero bytes32 value is not allowed.",
  })
  .transform((value) => value.toLowerCase() as Hex);
