export type DocId = "architecture" | "mcp" | "overview" | "quickstart";

type DocSection = {
  body: string;
  code?: string;
  items?: string[];
  title: string;
};

export const docs: Record<
  DocId,
  { eyebrow: string; intro: string; sections: DocSection[]; title: string }
> = {
  overview: {
    eyebrow: "Product overview",
    title: "A contract release pipeline where no agent approves itself.",
    intro:
      "SwarmShip turns one bounded natural-language request into a tested Rust Stylus contract, an owner-approved manifest, a real Arbitrum Sepolia deployment, and public proof.",
    sections: [
      {
        title: "The problem",
        body: "An autonomous coding agent can otherwise write code, approve its own output, and deploy it without trustworthy evidence of what was tested.",
      },
      {
        title: "Five separate responsibilities",
        body: "Specification defines authority. Build creates the fixed contract family. Verification reruns deterministic tests. Deployment uses only the signed artifact. Witness independently checks what landed onchain.",
        items: [
          "Models explain and call narrow tools. They never decide deterministic pass or fail.",
          "The owner signs the exact manifest before any deployment begins.",
          "HERŌ anchors proof roots before and after deployment.",
        ],
      },
      {
        title: "What a judge can verify",
        body: "The public proof shows agent transitions, artifact hashes, HERŌ anchors, the deployment transaction, the contract address, and the independent Witness receipt.",
      },
    ],
  },
  quickstart: {
    eyebrow: "Quickstart",
    title: "Start a real release in three steps.",
    intro:
      "The hosted application needs no local setup. Use the supported request shape, wait for deterministic verification, then approve with the specified owner wallet.",
    sections: [
      {
        title: "1. Describe one bounded registry",
        body: "Include the owner, permitted sender, permitted receiver, maximum handoffs, and expiry. SwarmShip asks for missing fields instead of inventing them.",
        code: "Create an agent task registry owned by 0xYOUR_ADDRESS. Allow 0xYOUR_ADDRESS to record at most 100 handoffs to 0xRECEIVER before 2027-01-01 00:00 UTC.",
      },
      {
        title: "2. Review and sign",
        body: "After the first three agents finish, connect the exact owner wallet and sign the EIP-712 release manifest. Signing is gasless. The signature binds the request, source, artifact, tests, toolchain, chain, and expiry.",
      },
      {
        title: "3. Share public proof",
        body: "The Deployment and Witness agents finish the testnet release. Share the proof URL so anyone can inspect what was approved and what actually landed.",
      },
    ],
  },
  mcp: {
    eyebrow: "Agent interface",
    title: "Two MCP tools, one predictable release boundary.",
    intro:
      "SwarmShip exposes only the actions another agent genuinely needs. The hosted endpoint is stateless Streamable HTTP, and the same server supports local stdio.",
    sections: [
      {
        title: "Hosted endpoint",
        body: "Connect an MCP client to the production endpoint. Browser origins are restricted, while non-browser MCP clients can call it directly.",
        code: "https://swarmship.vercel.app/api/mcp",
      },
      {
        title: "start_swarmship_release",
        body: "Starts one bounded five-agent release. It returns a public proof URL but cannot approve or deploy without the owner wallet.",
        code: '{\n  "request": "Create one bounded registry...",\n  "idempotencyKey": "my-release-001"\n}',
      },
      {
        title: "inspect_swarmship_proof",
        body: "Reads safe public state, agent transitions, hashes, and onchain evidence. It never returns source files, Wasm bytes, signatures, leases, or secrets.",
        code: '{\n  "publicId": "release_04f36195b7b04b02ae7e2ed049779cb7"\n}',
      },
      {
        title: "Local stdio",
        body: "Build the server, provide DATABASE_URL outside source control, and start the stdio transport.",
        code: "pnpm --filter @swarmship/server build\npnpm --filter @swarmship/server mcp",
      },
    ],
  },
  architecture: {
    eyebrow: "Architecture",
    title: "Trust lives where each decision can be checked.",
    intro:
      "PostgreSQL coordinates work, Arbitrum holds deployment truth, HERŌ anchors release evidence, and the owner wallet controls deployment authority.",
    sections: [
      {
        title: "Forward path",
        body: "User request → hosted React app → Hono API → Neon PostgreSQL → five-agent worker → owner signature → HERŌ manifest root → Rust Stylus deployment.",
      },
      {
        title: "Reverse path",
        body: "Contract event and bytecode → independent Witness RPC → deterministic source and runtime checks → HERŌ receipt root → PostgreSQL projection → public proof UI and MCP.",
      },
      {
        title: "Onchain and offchain",
        body: "The contract, deployment transaction, and proof roots live onchain because independent verification matters. Requests, leases, compiler logs, and cached projections stay offchain because they need speed, privacy, or retry control.",
      },
      {
        title: "Failure behavior",
        body: "RPC uncertainty enters reconciliation instead of blind retry. Duplicate events are idempotent. Stale workers lose their lease. Provider outages defer without creating negative evidence. A modified frontend cannot change the server-derived manifest.",
      },
    ],
  },
};

export function isDocId(value: string | null): value is DocId {
  return value !== null && value in docs;
}
