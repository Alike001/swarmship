import { LandingPage } from "./features/landing/LandingPage.js";
import { ProofPage } from "./features/proof/ProofPage.js";

export function App() {
  const proofId = new URLSearchParams(window.location.search).get("proof");

  return proofId ? <ProofPage proofId={proofId} /> : <LandingPage />;
}
