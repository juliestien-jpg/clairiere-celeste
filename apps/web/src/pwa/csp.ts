// Politique de sécurité du contenu du site publié, injectée dans index.html par le build (vite.config.ts).
// Stricte : aucun script ni style en ligne, pas d'eval. Le serveur de développement ne l'utilise pas (le rechargement
// à chaud de Vite a besoin d'un script en ligne et d'un WebSocket).
//
// - les styles posés par React passent par le CSSOM (`element.style`), que la CSP n'interdit pas ;
// - les SVG de la créature sont du balisage inséré dans la page : sans `style=` ni `<style>` (vérifié par un test) ;
// - `blob:` n'est pas nécessaire : les téléchargements passent par un lien `download`, hors du champ de `default-src`.
//   `frame-ancestors` n'est pas pris en charge dans une balise <meta> : il faudrait un en-tête HTTP (GitHub Pages n'en propose pas).

export const CSP_DIRECTIVES: Readonly<Record<string, string>> = {
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self'",
  "img-src": "'self' data:",
  "font-src": "'self'",
  "connect-src": "'self'",
  "manifest-src": "'self'",
  "worker-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'self'",
  "form-action": "'self'",
};

export function cspContent(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
}

/** Insère la balise <meta> juste après `<meta charset>` (ou au début de <head>) ; ne fait rien si elle y est déjà. */
export function injectCsp(html: string): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
  const tag = `<meta http-equiv="Content-Security-Policy" content="${cspContent()}" />`;
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  if (charset) return html.slice(0, charset.index + charset[0].length) + `\n    ${tag}` + html.slice(charset.index + charset[0].length);
  return html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`);
}
