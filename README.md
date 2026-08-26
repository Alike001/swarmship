# SwarmShip

Multi-agent smart contract releases you can prove.

[Live application](https://swarmship.vercel.app) · [Verified public proof](https://swarmship.vercel.app/?proof=live) · [Documentation](https://swarmship.vercel.app/?docs=overview) · [MCP guide](https://swarmship.vercel.app/?docs=mcp)

## The problem

An AI agent can write contract code, approve its own output, and deploy it without trustworthy evidence of what was tested. A user sees a transaction, but cannot prove that the deployed contract matches the reviewed request and artifact.

## The solution

SwarmShip separates one Rust Stylus release across five responsibilities:

1. Specification turns a bounded natural-language request into exact authority rules.
2. Build produces source from one fixed contract family.
3. Verification reconstructs the source and runs deterministic Rust and Stylus checks.
4. Deployment acts only after the owner signs the exact EIP-712 release manifest.
5. Witness independently checks the transaction, bytecode, activation, constructor state, and source.

HERŌ anchors the approved manifest root and final receipt root on Arbitrum Sepolia. The public proof page lets anyone compare the request, agent transitions, hashes, transactions, contract, and Witness result.

## Why multiple agents matter

Each agent has one narrow tool and one authority boundary. Model text never decides whether deterministic tests passed. The owner wallet remains the only release authority, while the relayer can deploy only the saved, signed artifact.

## Architecture

```text
User request
  → React web app
  → Hono API
  → Neon PostgreSQL
  → Specification → Build → Verification
  → owner EIP-712 signature
  → HERŌ manifest root
  → Rust Stylus deployment on Arbitrum Sepolia
  → independent Witness
  → HERŌ receipt root
  → public proof UI and MCP
```

Onchain state contains the contract, deployment transaction, and proof roots. Requests, leases, private build material, compiler logs, and fast read projections remain offchain. Unknown chain outcomes enter reconciliation before any retry.

## Real testnet evidence

- Network: Arbitrum Sepolia, chain `421614`
- Verified contract: [`0x2f48240834a18d03753926B3a59aBA3541fc1962`](https://sepolia.arbiscan.io/address/0x2f48240834a18d03753926B3a59aBA3541fc1962)
- Deployment transaction: [`0x82012e5ab7b88c9e561c4ad93ec93e8e19817e7db3670b5ae2db9c5c1da655a6`](https://sepolia.arbiscan.io/tx/0x82012e5ab7b88c9e561c4ad93ec93e8e19817e7db3670b5ae2db9c5c1da655a6)
- Approved manifest root: `0x069cac31c40fd9c624c80e8320ee30e741e4a141229368b17ea2944ff10454d3`
- Witness receipt root: `0x3279fa27e33efa125ceaf920d1eff02acd01808a3bc72d30c8527bf6066619be`

## MCP

Hosted Streamable HTTP endpoint:

```text
https://swarmship.vercel.app/api/mcp
```

The server exposes exactly two tools:

- `start_swarmship_release`: starts one bounded release and returns its public proof URL.
- `inspect_swarmship_proof`: reads safe public release state and evidence by public ID.

For local stdio, set `DATABASE_URL` outside source control, build the server, and run:

```bash
pnpm --filter @swarmship/server build
pnpm --filter @swarmship/server mcp
```

## Run locally

Requirements:

- Node.js 24+
- pnpm 10.33.1
- PostgreSQL 17.6 for integration tests
- Rust 1.96.0 and `cargo-stylus` 0.10.9 for contract checks

```bash
pnpm install --frozen-lockfile
pnpm db:test:up
pnpm verify
pnpm dev
```

Copy only the relevant `.env.example` files when running the API or worker. Never place private keys or model credentials in frontend variables.

## Quality gates

The repository checks formatting, Oxlint, TypeScript, real PostgreSQL integration behavior, Rust TestVM tests, strict Clippy, optimized Wasm builds, source-size limits, secret patterns, and Playwright flows on desktop and mobile.

Important negative paths include wrong wallets, expired approvals, stale worker leases, duplicate requests, malformed agent output, RPC uncertainty, source mismatch, untrusted browser origins, and missing public proofs.

## Current scope

V1 supports one contract family, one network, one owner approval, five role-separated agent responsibilities, two HERŌ proof anchors, one public verifier, and two MCP tools. Unsupported behavior is rejected or labelled incomplete instead of simulated.

## Stack

React, Vite, Hono, PostgreSQL, TypeScript, Rust, Arbitrum Stylus, Viem, HERŌ proof anchoring, Model Context Protocol, Vercel, Neon, Vitest, and Playwright.
