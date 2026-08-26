import { BrandMark } from "../../components/BrandMark.js";
import { SiteHeader } from "../../components/SiteHeader.js";
import { ReleaseIntake } from "../release/ReleaseIntake.js";
import { ProofRelay } from "./ProofRelay.js";
import { trustEvidence } from "./relay-data.js";
import { useProofMotion } from "./useProofMotion.js";

export function LandingPage() {
  const scope = useProofMotion();

  return (
    <div ref={scope}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Multi-agent contract release</span>
            <h1>
              Ship contracts through agents <em>you can verify.</em>
            </h1>
            <p>
              One agent should not be able to write, approve, and deploy its own
              contract release.
            </p>
            <div className="hero-actions">
              <a className="button" href="#release">
                Start a release
              </a>
              <a className="button button-secondary" href="/?proof=live">
                See verified proof
              </a>
            </div>
          </div>
          <div className="hero-proof" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <i key={index} />
            ))}
            <span />
          </div>
        </section>
        <ProofRelay />
        <section className="trust-section" aria-labelledby="trust-title">
          <div className="trust-heading">
            <span className="section-kicker">Why it matters</span>
            <h2 id="trust-title">
              One agent cannot be the writer, approver, and deployer.
            </h2>
            <p>Separation creates trust.</p>
          </div>
          <div className="evidence-stack">
            {trustEvidence.map(([title, description], index) => (
              <article className="evidence-sheet" key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        <ReleaseIntake />
        <section className="final-cta">
          <h2>
            Release through separate agents. <em>Leave with public proof.</em>
          </h2>
          <div>
            <a className="button" href="#release">
              Start a release
            </a>
            <a className="button button-secondary" href="/?docs=overview">
              Read the documentation
            </a>
          </div>
        </section>
      </main>
      <footer id="docs">
        <BrandMark />
        <nav aria-label="Footer navigation">
          <a href="#product">Product</a>
          <a href="/?docs=overview">Docs</a>
          <a href="/?docs=mcp">MCP</a>
          <a href="/?proof=live">Public Proof</a>
          <a href="https://github.com/Alike001/swarmship">GitHub</a>
          <a href="https://sepolia.arbiscan.io/address/0x2f48240834a18d03753926B3a59aBA3541fc1962">
            Arbitrum Sepolia
          </a>
        </nav>
        <p>Live testnet evidence. Unavailable steps are labelled honestly.</p>
      </footer>
    </div>
  );
}
