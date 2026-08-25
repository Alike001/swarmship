import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function validateRpcUrl(rpcUrl: string): void {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("RPC URL must use HTTP or HTTPS.");
  }
}

export type HeroPublicClient = PublicClient<
  HttpTransport,
  typeof arbitrumSepolia
>;
export type HeroWalletClient = WalletClient<
  HttpTransport,
  typeof arbitrumSepolia,
  PrivateKeyAccount
>;

export function createHeroPublicClient(rpcUrl: string): HeroPublicClient {
  validateRpcUrl(rpcUrl);
  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl, { retryCount: 2, timeout: 10_000 }),
  });
}

export function createHeroWalletClient(
  rpcUrl: string,
  privateKey: Hex,
): HeroWalletClient {
  validateRpcUrl(rpcUrl);
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new TypeError("Relayer private key must be exactly 32 bytes.");
  }
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: arbitrumSepolia,
    transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }),
  });
}
