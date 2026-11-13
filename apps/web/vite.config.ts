import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { buildServiceWorker } from "./src/pwa/serviceWorkerBuild.ts";

// Racine du dépôt (deux niveaux au-dessus de apps/web) : `spec/` et `assets/` y vivent, hors du projet Vite.
// La créature importe poses.json, particles.json, theme.json (JSON) et les parties SVG (`?raw`) depuis là.
const repoRoot = decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Écrit dist/sw.js (précache de tous les fichiers du build) une fois le build terminé. Sans dépendance. */
function serviceWorkerPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "tamagoshi-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = listFiles(outDir).map((f) => relative(outDir, f));
      const template = readFileSync(new URL("./src/sw/sw.js", import.meta.url), "utf-8");
      writeFileSync(join(outDir, "sw.js"), buildServiceWorker(template, files));
    },
  };
}

// Serveur de développement local uniquement (127.0.0.1:5173, port imposé), avec accès au dépôt entier.
export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [repoRoot] } },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
