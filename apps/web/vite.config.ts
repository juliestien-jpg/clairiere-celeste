import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Racine du dépôt (deux niveaux au-dessus de apps/web) : `spec/` et `assets/` y vivent, hors du projet Vite.
// La créature importe poses.json, particles.json, theme.json (JSON) et les parties SVG (`?raw`) depuis là.
const repoRoot = decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

// Serveur de développement local uniquement (127.0.0.1:5173, port imposé), avec accès au dépôt entier.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [repoRoot] } },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
