import type { PublicRelease } from "../../lib/api.js";

export const liveProof: PublicRelease = {
  release: {
    approval: {
      approvedAt: "2026-08-26T00:00:00.000Z",
      digest:
        "0x069cac31c40fd9c624c80e8320ee30e741e4a141229368b17ea2944ff10454d3",
      signer: "0xdE67A35B322e5A31e8215B5245CA4e48d7977F71",
    },
    build: {
      evidenceRef:
        "0x6d7a2a9c996e6ef40b2ddeb4910642494a7854709776f28b5e1d9e3f6208ef02",
      sourceHash:
        "0x6d7a2a9c996e6ef40b2ddeb4910642494a7854709776f28b5e1d9e3f6208ef02",
    },
    deployment: {
      contractAddress: "0x2f48240834a18d03753926B3a59aBA3541fc1962",
      status: "confirmed",
      transactionHash:
        "0x82012e5ab7b88c9e561c4ad93ec93e8e19817e7db3670b5ae2db9c5c1da655a6",
      verificationStatus: "passed",
    },
    manifestAnchor: {
      proofRoot:
        "0x069cac31c40fd9c624c80e8320ee30e741e4a141229368b17ea2944ff10454d3",
      status: "confirmed",
      transactionHash:
        "0xd0bb8318577a41a49e04cced8639d3eaf7c743299b7b8627af1132ad48ef9f0a",
    },
    publicId: "live-arbitrum-sepolia-release",
    receipt: {
      anchorStatus: "confirmed",
      anchorTransactionHash:
        "0xb62f24169d97d7759e343ef6de591190f8aba99982dfa7d2b08e25594d2a14f0",
      officialChainId: 421614,
      receiptRoot:
        "0x3279fa27e33efa125ceaf920d1eff02acd01808a3bc72d30c8527bf6066619be",
      witnessChainId: 421614,
    },
    releaseId: "recorded-live-evidence",
    request:
      "Create a bounded agent task registry where approved agents can create and complete tasks.",
    safeError: null,
    specification: {
      owner: "0xdE67A35B322e5A31e8215B5245CA4e48d7977F71",
      permittedReceiver: "0x1111111111111111111111111111111111111111",
      permittedSender: "0xdE67A35B322e5A31e8215B5245CA4e48d7977F71",
    },
    specificationSummary:
      "Owner-controlled agent access, bounded task creation, and one-time completion on Arbitrum Sepolia.",
    state: "verified",
    verification: {
      artifactHash:
        "0x6d7a2a9c996e6ef40b2ddeb4910642494a7854709776f28b5e1d9e3f6208ef02",
      checks: [
        { name: "Rust tests", status: "passed" },
        { name: "Strict Clippy", status: "passed" },
        { name: "Stylus build", status: "passed" },
        { name: "Source verification", status: "passed" },
      ],
      status: "passed",
    },
    version: 7,
  },
  transitions: [
    {
      actor: "specification",
      createdAt: "2026-08-26T00:00:00.000Z",
      safeSummary: "The request became one bounded contract specification.",
      toState: "specified",
    },
    {
      actor: "build",
      createdAt: "2026-08-26T00:00:01.000Z",
      safeSummary: "The exact Rust Stylus source was generated and hashed.",
      toState: "built",
    },
    {
      actor: "verification",
      createdAt: "2026-08-26T00:00:02.000Z",
      safeSummary: "All deterministic checks passed in a clean workspace.",
      toState: "verified_for_approval",
    },
    {
      actor: "deployment",
      createdAt: "2026-08-26T00:00:03.000Z",
      safeSummary: "The approved artifact was deployed and source verified.",
      toState: "deployed_unverified",
    },
    {
      actor: "witness",
      createdAt: "2026-08-26T00:00:04.000Z",
      safeSummary:
        "Independent checks matched and the receipt root was anchored.",
      toState: "verified",
    },
  ],
};
