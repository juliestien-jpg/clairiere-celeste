// Préfixe les identifiants d'un SVG (dégradés, clips) pour pouvoir en poser plusieurs dans un document.
export function prefixIds(markup: string, prefix: string): string {
  return markup
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`);
}
