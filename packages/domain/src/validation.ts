import type { ZodError } from "zod";

export const MAX_SUPPORTED_UNIX_SECONDS = 253_402_300_799;

export type FieldValidationError = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldValidationError[] };

export function fieldErrors(error: ZodError): FieldValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? "request" : issue.path.join("."),
    message: issue.message,
  }));
}

export function assertCurrentUnixSeconds(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SUPPORTED_UNIX_SECONDS
  ) {
    throw new RangeError(
      "Current time must be a supported whole Unix timestamp.",
    );
  }
}
