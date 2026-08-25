# SwarmShip Rough 90-Second Demo Script

Status: Approved scope check for Phase 4 implementation on 2026-08-25

This is the Phase 4 scope test. It is not the final polished pitch.

## 0 to 10 seconds: make the problem obvious

Show the landing hero and five-agent Proof Relay.

Say: “AI can now write and deploy smart contracts, but one agent should not be able to interpret, approve, and ship its own work. SwarmShip separates the release and leaves public proof.”

Proof shown: the product, problem, five responsibilities, and final verified destination are visible in one frame.

## 10 to 25 seconds: give the swarm one bounded job

Select the safe task-registry example. Show the owner, sender agent, receiver agent, two-handoff limit, and expiry in plain language.

Deliberately change the expiry to a past time and submit it. The Specification Agent must block the request before source generation and say why. Correct the expiry and continue.

Proof shown: the agents have boundaries, bad input stops real work, and the failure is recoverable.

## 25 to 43 seconds: show separate agents doing real work

Follow the relay through Specification, Build, and Verify.

Open the verification inspector briefly and show the five named deterministic checks: authorized handoff, unauthorized caller, duplicate task, maximum handoffs, and expiry. Show the Rust and Stylus toolchain evidence without reading raw logs aloud.

Proof shown: agents use real tools, and the model cannot talk a failing test into passing.

## 43 to 57 seconds: approve the exact release

Show the plain-language manifest and its exact root. Sign it with the connected wallet. Point out that the signature costs no gas and any edit invalidates it.

Proof shown: the user, rather than an agent, authorizes the exact artifact and configuration.

## 57 to 77 seconds: perform the trust-critical release

Show the Deployment Agent confirm the HERŌ manifest root, then deploy and activate the Rust Stylus contract on Arbitrum Sepolia. Open the transaction link only long enough to show that it is real.

Proof shown: HERŌ is a required precondition and the result is a real decentralized-network deployment.

## 77 to 90 seconds: finish with independent proof

Show the Witness Agent reading the chain through its separate connection. End on the public verifier with the contract address, deployment transaction, manifest root, receipt root, five passed checks, and the teal independently verified state.

Say: “The release can now be checked by anyone, even if they do not trust SwarmShip.”

Core moment: the Witness Agent independently observes the exact approved contract and the relay changes to verified only after the final HERŌ receipt root matches.

## Sanity-check result

The product story fits into 90 seconds without adding features or cutting the approved scope.

The execution time is still an untested technical risk. A cold Rust build, Stylus deployment, activation, verification, and two anchors may exceed the speaking window. The first real end-to-end timing test must decide between:

1. Running the entire warmed workflow live when it reliably completes within 90 seconds.
2. Opening a genuinely prepared release at `awaiting_approval`, showing its real request, source, and test evidence, then performing the signature, anchors, deployment, witness, and proof live.

The second path does not use fake evidence. It shortens waiting by preparing the reversible build and test stages before the presentation while keeping every trust-critical action live.
