export type HeroChainErrorCode =
  | "invalid_root"
  | "wrong_chain"
  | "anchor_not_deployed"
  | "missing_wallet_account"
  | "invalid_reconciliation_range"
  | "deployer_not_available"
  | "insufficient_relayer_balance";

export class HeroChainError extends Error {
  readonly code: HeroChainErrorCode;

  constructor(code: HeroChainErrorCode, message: string) {
    super(message);
    this.name = "HeroChainError";
    this.code = code;
  }
}
