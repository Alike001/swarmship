import { useEffect, useState } from "react";
import { SiteHeader } from "../../components/SiteHeader.js";
import { getPublicRelease, type PublicRelease } from "../../lib/api.js";
import { liveProof } from "./live-proof.js";

const explorer = "https://sepolia.arbiscan.io";
const compact = (value: string) =>
  value.startsWith("0x") && value.length > 28
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : value;

export function ProofPage({ proofId }: { proofId: string }) {
  const [data, setData] = useState<PublicRelease | null>(
    proofId === "live" ? liveProof : null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (proofId === "live") return;
    void getPublicRelease(proofId)
      .then(setData)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "This proof could not be loaded.",
        );
      });
  }, [proofId]);

  if (error) return <ProofFailure message={error} />;
  if (!data)
    return <main className="proof-loading">Loading public proof…</main>;

  const { release, transitions } = data;
  const complete =
    release.state === "verified" &&
    release.receipt?.anchorStatus === "confirmed";

  return (
    <div className="proof-page">
      <SiteHeader compact />
      <main>
        <section className="proof-outcome">
          <span className={complete ? "verified-label" : "pending-label"}>
            {complete ? "Verified release" : "Release in progress"}
          </span>
          <h1>
            {complete
              ? "The deployed contract matches the release that was approved."
              : "This release has not produced complete public proof yet."}
          </h1>
          <p>{release.request}</p>
          {proofId === "live" && (
            <small>
              Recorded from a real Arbitrum Sepolia run and independently
              checked through two RPC providers.
            </small>
          )}
        </section>

        <section className="proof-journey" aria-labelledby="journey-title">
          <span className="section-kicker">Five separate responsibilities</span>
          <h2 id="journey-title">What each agent proved</h2>
          <ol>
            {transitions.map((transition, index) => (
              <li key={`${transition.actor}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{transition.actor}</strong>
                  <p>
                    {transition.safeSummary ??
                      `Advanced the release to ${transition.toState}.`}
                  </p>
                </div>
                <b>{transition.toState.replaceAll("_", " ")}</b>
              </li>
            ))}
          </ol>
        </section>

        <section className="proof-details" aria-labelledby="evidence-title">
          <div>
            <span className="section-kicker">Public evidence</span>
            <h2 id="evidence-title">Inspect the result yourself</h2>
            <p>
              Hashes bind the user's request to the tested artifact. Arbitrum
              records deployment, while HERŌ anchors the before and after proof
              roots.
            </p>
          </div>
          <dl>
            <Evidence
              label="Contract"
              value={release.deployment?.contractAddress}
              href={
                release.deployment?.contractAddress
                  ? `${explorer}/address/${release.deployment.contractAddress}`
                  : undefined
              }
            />
            <Evidence
              label="Deployment transaction"
              value={release.deployment?.transactionHash}
              href={
                release.deployment?.transactionHash
                  ? `${explorer}/tx/${release.deployment.transactionHash}`
                  : undefined
              }
            />
            <Evidence
              label="Approved manifest root"
              value={release.manifestAnchor?.proofRoot}
              href={
                release.manifestAnchor?.transactionHash
                  ? `${explorer}/tx/${release.manifestAnchor.transactionHash}`
                  : undefined
              }
            />
            <Evidence
              label="Witness receipt root"
              value={release.receipt?.receiptRoot}
              href={
                release.receipt?.anchorTransactionHash
                  ? `${explorer}/tx/${release.receipt.anchorTransactionHash}`
                  : undefined
              }
            />
            <Evidence
              label="Verified artifact"
              value={release.verification?.artifactHash}
            />
            <Evidence
              label="Network"
              value={
                release.receipt
                  ? `Arbitrum Sepolia · chain ${release.receipt.officialChainId}`
                  : undefined
              }
            />
          </dl>
        </section>

        {release.verification && (
          <section className="check-strip" aria-label="Deterministic checks">
            {release.verification.checks.map((check) => (
              <div key={check.name}>
                <span aria-hidden="true">✓</span>
                <strong>{check.name}</strong>
                <small>{check.status}</small>
              </div>
            ))}
          </section>
        )}
        <a className="button proof-home" href="/">
          Start another release
        </a>
      </main>
    </div>
  );
}

function Evidence({
  href,
  label,
  value,
}: {
  href?: string | undefined;
  label: string;
  value?: null | string | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          href ? (
            <a href={href} rel="noreferrer" target="_blank">
              {compact(value)} <span>↗</span>
            </a>
          ) : (
            <code>{compact(value)}</code>
          )
        ) : (
          <span className="missing">Not available yet</span>
        )}
      </dd>
    </div>
  );
}

function ProofFailure({ message }: { message: string }) {
  return (
    <div className="proof-page">
      <SiteHeader compact />
      <main className="proof-failure">
        <span className="error-label">Proof unavailable</span>
        <h1>We cannot verify this release.</h1>
        <p>{message}</p>
        <a className="button button-secondary" href="/">
          Return home
        </a>
      </main>
    </div>
  );
}
