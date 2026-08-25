export type PersistenceErrorCode =
  | "idempotency_conflict"
  | "release_not_found"
  | "transition_rejected"
  | "transition_conflict"
  | "lease_lost";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}
