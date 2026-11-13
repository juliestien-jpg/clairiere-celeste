// Génère les icônes de l'application (SVG + PNG) dans public/icons/, sans dépendance :
// un petit rasteriseur (sur-échantillonnage 4x4) dessine la même scène que le SVG.
// Usage : node apps/web/scripts/make-icons.mjs
// Dessin : la créature (corps rond, oreilles à bourgeon d'or, joues) sous une étincelle à quatre branches,
// sur un fond « nuit d'encre » (palette D4, spec/theme.json).
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const INK = "#1B1838";
const INDIGO = "#2E2A5C";
const CREAM = "#FFF6E9";
const GOLD = "#FFD27A";
const PEACH = "#FFB89A";

const hexCache = new Map();
const hex = (h) => {
  let v = hexCache.get(h);
  if (!v) hexCache.set(h, (v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  return v;
};

/** Étincelle à quatre branches (courbes quadratiques vers le centre) : SVG et polygone échantillonné. */
function sparkle(cx, cy, r) {
  const pts = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
  const d = `M${cx} ${cy - r}` + pts.slice(1).concat([pts[0]]).map(([x, y]) => ` Q${cx} ${cy} ${x} ${y}`).join("") + "Z";
  const poly = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    for (let t = 0; t < 1; t += 0.05) {
      const m = 1 - t;
      poly.push([m * m * a[0] + 2 * m * t * cx + t * t * b[0], m * m * a[1] + 2 * m * t * cy + t * t * b[1]]);
    }
  }
  return { d, poly };
}
function inPoly(poly, x, y) {
  if (!poly.box) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    poly.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const b = poly.box;
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Scène en coordonnées 0..1. `s` : échelle autour du centre (icône masquable : contenu dans la zone sûre). */
function scene(s) {
  const T = (v) => 0.5 + (v - 0.5) * s;
  const R = (v) => v * s;
  const sp1 = sparkle(T(0.74), T(0.25), R(0.11));
  const sp2 = sparkle(T(0.25), T(0.3), R(0.05));
  const layers = [
    { kind: "halo", cx: T(0.5), cy: T(0.58), r: R(0.36) },
    { kind: "ellipse", cx: T(0.41), cy: T(0.41), rx: R(0.045), ry: R(0.085), fill: CREAM },
    { kind: "ellipse", cx: T(0.59), cy: T(0.41), rx: R(0.045), ry: R(0.085), fill: CREAM },
    { kind: "ellipse", cx: T(0.5), cy: T(0.6), rx: R(0.22), ry: R(0.2), fill: CREAM },
    { kind: "ellipse", cx: T(0.405), cy: T(0.325), rx: R(0.034), ry: R(0.034), fill: GOLD },
    { kind: "ellipse", cx: T(0.595), cy: T(0.325), rx: R(0.034), ry: R(0.034), fill: GOLD },
    { kind: "ellipse", cx: T(0.425), cy: T(0.585), rx: R(0.03), ry: R(0.034), fill: INK },
    { kind: "ellipse", cx: T(0.575), cy: T(0.585), rx: R(0.03), ry: R(0.034), fill: INK },
    { kind: "ellipse", cx: T(0.435), cy: T(0.572), rx: R(0.01), ry: R(0.01), fill: CREAM },
    { kind: "ellipse", cx: T(0.585), cy: T(0.572), rx: R(0.01), ry: R(0.01), fill: CREAM },
    { kind: "ellipse", cx: T(0.35), cy: T(0.655), rx: R(0.035), ry: R(0.025), fill: PEACH, alpha: 0.85 },
    { kind: "ellipse", cx: T(0.65), cy: T(0.655), rx: R(0.035), ry: R(0.025), fill: PEACH, alpha: 0.85 },
    { kind: "poly", ...sp1, fill: GOLD },
    { kind: "poly", ...sp2, fill: CREAM },
  ];
  return layers;
}

const SPECS = [
  { file: "icon", scale: 1, rounded: true },
  { file: "icon-maskable", scale: 0.8, rounded: false },
];

function svgFor({ scale, rounded }) {
  const f = (n) => +n.toFixed(4);
  const body = scene(scale)
    .map((l) => {
      if (l.kind === "halo") return `<circle cx="${f(l.cx)}" cy="${f(l.cy)}" r="${f(l.r)}" fill="url(#halo)"/>`;
      if (l.kind === "ellipse") {
        const a = l.alpha ? ` opacity="${l.alpha}"` : "";
        return `<ellipse cx="${f(l.cx)}" cy="${f(l.cy)}" rx="${f(l.rx)}" ry="${f(l.ry)}" fill="${l.fill}"${a}/>`;
      }
      return `<path d="${l.d.replace(/-?\d+\.?\d*/g, (n) => String(f(+n)))}" fill="${l.fill}"/>`;
    })
    .join("\n  ");
  const bg = rounded
    ? `<rect width="1" height="1" rx="0.22" fill="url(#bg)"/>`
    : `<rect width="1" height="1" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="512" height="512">
  <title>Clairière céleste</title>
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="${INDIGO}"/><stop offset="1" stop-color="${INK}"/></radialGradient>
    <radialGradient id="halo"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.55"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg}
  ${body}
</svg>
`;
}

// --- Rasteriseur ---------------------------------------------------------------------------------

function over(dst, src, a) {
  const outA = a + dst[3] * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((i) => (src[i] * a + dst[i] * dst[3] * (1 - a)) / outA).concat([outA]);
}

function sample(layers, rounded, u, v) {
  let px = [0, 0, 0, 0];
  // fond
  const inRounded = (() => {
    if (!rounded) return true;
    const r = 0.22;
    const dx = Math.max(r - u, 0, u - (1 - r));
    const dy = Math.max(r - v, 0, v - (1 - r));
    return dx * dx + dy * dy <= r * r;
  })();
  if (!inRounded) return px;
  const d = Math.min(1, Math.hypot(u - 0.5, v - 0.4) / 0.75);
  const c0 = hex(INDIGO);
  const c1 = hex(INK);
  px = [...[0, 1, 2].map((i) => c0[i] + (c1[i] - c0[i]) * d), 1];
  for (const l of layers) {
    if (l.kind === "halo") {
      const t = Math.hypot(u - l.cx, v - l.cy) / l.r;
      if (t < 1) px = over(px, hex(GOLD), 0.55 * (1 - t));
    } else if (l.kind === "ellipse") {
      const t = ((u - l.cx) / l.rx) ** 2 + ((v - l.cy) / l.ry) ** 2;
      if (t <= 1) px = over(px, hex(l.fill), l.alpha ?? 1);
    } else if (inPoly(l.poly, u, v)) px = over(px, hex(l.fill), 1);
  }
  return px;
}

function raster(spec, size) {
  const layers = scene(spec.scale);
  const N = 3;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const p = sample(layers, spec.rounded, (x + (i + 0.5) / N) / size, (y + (j + 0.5) / N) / size);
          r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return encodePng(size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const spec of SPECS) writeFileSync(new URL(`${spec.file}.svg`, OUT), svgFor(spec));
writeFileSync(new URL("icon-192.png", OUT), raster(SPECS[0], 192));
writeFileSync(new URL("icon-512.png", OUT), raster(SPECS[0], 512));
writeFileSync(new URL("icon-maskable-512.png", OUT), raster(SPECS[1], 512));
writeFileSync(new URL("apple-touch-icon.png", OUT), raster(SPECS[1], 180));
console.log("icônes générées dans", OUT.pathname);
