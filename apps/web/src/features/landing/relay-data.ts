export const relaySteps = [
  {
    name: "Specification",
    role: "Turns one plain request into a bounded contract specification.",
    allowed:
      "Read the request, ask for missing fields, write the specification.",
    forbidden:
      "Cannot write code, approve, deploy, or mark its own work verified.",
    glyph: "01",
  },
  {
    name: "Build",
    role: "Produces the exact Rust Stylus source bound to that specification.",
    allowed:
      "Render one allowlisted contract family and hash every source file.",
    forbidden: "Cannot change the approved scope, run verification, or deploy.",
    glyph: "02",
  },
  {
    name: "Verify",
    role: "Rebuilds in a clean workspace and runs deterministic checks.",
    allowed:
      "Run the fixed Rust and Stylus test plan and record artifact hashes.",
    forbidden: "Cannot edit source, waive a failed check, approve, or deploy.",
    glyph: "03",
  },
  {
    name: "Deploy",
    role: "Acts only after the exact manifest receives the user's signature.",
    allowed: "Anchor the manifest and deploy the already verified artifact.",
    forbidden:
      "Cannot change the artifact or treat an unknown chain result as success.",
    glyph: "04",
  },
  {
    name: "Witness",
    role: "Independently checks what landed onchain and anchors the receipt.",
    allowed:
      "Read two RPCs, compare bytecode, verify source, and publish proof.",
    forbidden:
      "Cannot deploy, reuse the deployer's claim, or hide missing evidence.",
    glyph: "05",
  },
] as const;

export const trustEvidence = [
  [
    "Exact approval",
    "The user's signature binds the specification, source, artifact, chain, and expiry.",
  ],
  [
    "Deterministic checks",
    "The same locked tests rerun from the same source and produce the same artifact.",
  ],
  [
    "Real deployment",
    "A separate agent deploys only the artifact the user approved to Arbitrum Sepolia.",
  ],
  [
    "Independent proof",
    "Witness checks both RPC views, source verification, bytecode, and HERŌ receipt roots.",
  ],
  [
    "Honest recovery",
    "Unknown transactions pause for reconciliation. Duplicate actions never spend gas twice.",
  ],
] as const;
