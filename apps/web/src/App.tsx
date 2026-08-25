import { PRODUCT } from "@swarmship/domain";

export function App() {
  return (
    <main className="foundation-shell">
      <div className="foundation-mark" aria-hidden="true">
        S
      </div>
      <h1>{PRODUCT.name}</h1>
      <p>{PRODUCT.tagline}</p>
      <small>
        Foundation verification surface. The approved Proof Relay interface is
        the next frontend slice.
      </small>
    </main>
  );
}
