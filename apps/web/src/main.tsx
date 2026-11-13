import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPalette } from "./theme/theme";
import "./styles.css";

applyPalette();

const root = document.getElementById("root");
if (!root) throw new Error("élément #root introuvable");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
