// Fabrication de dist/sw.js à partir de src/sw/sw.js : fonctions pures (testées), utilisées par le
// greffon de build de vite.config.ts.

/** Fichiers à précacher : tout le build sauf le service worker lui-même et les cartes de source. */
export function precacheList(files: readonly string[]): string[] {
  return files
    .map((f) => f.replaceAll("\\", "/").replace(/^\.?\//, ""))
    .filter((f) => f !== "" && f !== "sw.js" && !f.endsWith(".map"))
    .sort();
}

/** Version : empreinte de la liste (les noms de fichiers générés contiennent déjà un hachage de contenu). */
export function swVersion(list: readonly string[], extra = ""): string {
  // Deux empreintes FNV-1a 32 bits (graines différentes) : suffisant pour distinguer deux builds.
  const text = `${list.join("\n")}\n${extra}`;
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export function buildServiceWorker(template: string, files: readonly string[], extra = ""): string {
  const list = precacheList(files);
  return template.replace("__VERSION__", () => swVersion(list, extra)).replace("__PRECACHE__", () => JSON.stringify(list, null, 2));
}
