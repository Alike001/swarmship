import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono/400.css";

import { App } from "./App.js";
import "./styles.css";
import "./styles/landing.css";
import "./styles/proof.css";
import "./styles/release.css";
import "./styles/responsive.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) throw new Error("SwarmShip root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
