import { SiteHeader } from "../../components/SiteHeader.js";
import { docs, type DocId } from "./docs-content.js";

const navigation: { id: DocId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "mcp", label: "MCP tools" },
  { id: "architecture", label: "Architecture" },
];

export function DocumentationPage({ docId }: { docId: DocId }) {
  const page = docs[docId];
  return (
    <div className="docs-page">
      <SiteHeader compact />
      <main>
        <aside aria-label="Documentation sections">
          <span className="section-kicker">Documentation</span>
          <nav>
            {navigation.map((item) => (
              <a
                aria-current={item.id === docId ? "page" : undefined}
                href={`/?docs=${item.id}`}
                key={item.id}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a className="docs-proof-link" href="/?proof=live">
            Inspect verified proof ↗
          </a>
        </aside>
        <article>
          <header>
            <span className="eyebrow">{page.eyebrow}</span>
            <h1>{page.title}</h1>
            <p>{page.intro}</p>
          </header>
          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
              {section.items && (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.code && <pre>{section.code}</pre>}
            </section>
          ))}
          <div className="docs-next">
            <a className="button" href="/#release">
              Start a release
            </a>
            <a
              className="button button-secondary"
              href="https://github.com/Alike001/swarmship"
            >
              View source
            </a>
          </div>
        </article>
      </main>
    </div>
  );
}
