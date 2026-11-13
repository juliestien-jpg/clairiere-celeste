// Chemins de l'application : toujours relatifs à `import.meta.env.BASE_URL` (« / » en local,
// « /clairiere-celeste/ » sur GitHub Pages), jamais écrits en dur.

/** Base normalisée : commence et finit par « / ». */
export function normalizeBase(base: string): string {
  let b = base.trim();
  if (b === "" || b === "./") return "/";
  if (!b.startsWith("/")) b = `/${b}`;
  if (!b.endsWith("/")) b = `${b}/`;
  return b;
}

/** Chemin d'un fichier public (icône, service worker…) sous la base. */
export function publicUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  return normalizeBase(base) + path.replace(/^\/+/, "");
}

export const SW_FILE = "sw.js";
