import { BrandMark } from "./BrandMark.js";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="site-header">
      <a className="brand-link" href="/" aria-label="SwarmShip home">
        <BrandMark />
      </a>
      <nav aria-label="Primary navigation">
        {!compact && <a href="#product">Product</a>}
        <a href="/?docs=overview">Docs</a>
        <a href="/?docs=mcp">MCP</a>
        {!compact && (
          <a className="button button-small" href="#release">
            Start a release
          </a>
        )}
      </nav>
    </header>
  );
}
