import { DocumentationPage } from "./features/docs/DocumentationPage.js";
import { isDocId } from "./features/docs/docs-content.js";
import { LandingPage } from "./features/landing/LandingPage.js";
import { ProofPage } from "./features/proof/ProofPage.js";

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  const proofId = parameters.get("proof");
  const docId = parameters.get("docs");

  if (proofId) return <ProofPage proofId={proofId} />;
  if (isDocId(docId)) return <DocumentationPage docId={docId} />;
  return <LandingPage />;
}
