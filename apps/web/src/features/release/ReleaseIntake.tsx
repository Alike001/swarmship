import { useRef, useState, type FormEvent } from "react";
import { createRelease, type ReleaseProjection } from "../../lib/api.js";

const example =
  "Create an agent task registry where only the owner can approve agents, approved agents can create and complete tasks, and the registry holds at most 100 tasks.";

export function ReleaseIntake() {
  const idempotencyKey = useRef(crypto.randomUUID());
  const [request, setRequest] = useState(example);
  const [release, setRelease] = useState<ReleaseProjection | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      setRelease(await createRelease(request, idempotencyKey.current));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The release could not be started.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="intake-section"
      id="release"
      aria-labelledby="release-title"
    >
      <div className="intake-heading">
        <span className="section-kicker">One bounded release</span>
        <h2 id="release-title">
          Describe the registry. The relay handles the release.
        </h2>
        <p>
          SwarmShip v1 supports one Rust Stylus agent task registry on Arbitrum
          Sepolia.
        </p>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="release-request">Contract request</label>
        <textarea
          id="release-request"
          maxLength={2000}
          minLength={20}
          onChange={(event) => {
            setRequest(event.target.value);
            idempotencyKey.current = crypto.randomUUID();
          }}
          required
          rows={6}
          value={request}
        />
        <div className="supported-fields">
          <span>Owner authority</span>
          <span>Approved agents</span>
          <span>Task limit</span>
          <span>Create and complete rules</span>
        </div>
        <button className="button" disabled={pending} type="submit">
          {pending ? "Starting release…" : "Start the five-agent relay"}
        </button>
        {message && (
          <p className="form-message error" role="alert">
            {message}
          </p>
        )}
        {release && (
          <div className="release-created" aria-live="polite">
            <span className="verified-label">Request accepted</span>
            <p>
              Your release is in{" "}
              <strong>{release.state.replaceAll("_", " ")}</strong>. Its public
              ID is <code>{release.publicId}</code>.
            </p>
            <a href={`/?proof=${encodeURIComponent(release.publicId)}`}>
              Open public proof
            </a>
          </div>
        )}
      </form>
    </section>
  );
}
