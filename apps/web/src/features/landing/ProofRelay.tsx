import { useState } from "react";
import { relaySteps } from "./relay-data.js";

export function ProofRelay() {
  const [selected, setSelected] = useState(0);
  const step = relaySteps[selected] ?? relaySteps[0];

  return (
    <section
      className="relay-section"
      id="product"
      aria-labelledby="relay-title"
    >
      <div className="section-kicker" id="relay-title">
        Proof relay
      </div>
      <div className="relay-track" role="tablist" aria-label="Release agents">
        <div className="relay-progress" aria-hidden="true" />
        {relaySteps.map((item, index) => (
          <button
            aria-controls="agent-inspector"
            aria-selected={selected === index}
            className="relay-station"
            key={item.name}
            onClick={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            role="tab"
          >
            <span className="station-glyph">{item.glyph}</span>
            <span>{item.name}</span>
          </button>
        ))}
        <span className="proof-root" aria-label="Public proof root">
          <i /> Proof root
        </span>
      </div>
      <div className="agent-inspector" id="agent-inspector" role="tabpanel">
        <div>
          <span className="eyebrow">{step.name} agent</span>
          <h2>{step.role}</h2>
        </div>
        <dl>
          <div>
            <dt>May do</dt>
            <dd>{step.allowed}</dd>
          </div>
          <div>
            <dt>Cannot do</dt>
            <dd>{step.forbidden}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
