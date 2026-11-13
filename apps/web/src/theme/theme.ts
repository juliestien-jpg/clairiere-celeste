// Jetons de spec/theme.json → variables CSS, et ciel selon l'heure locale virtuelle.
import themeJson from "../../../../spec/theme.json";
import type { SkyId, SkySpec, ThemeSpec } from "../creature/types";

export const theme = themeJson as unknown as ThemeSpec;

const SKY_ORDER: readonly SkyId[] = ["dawn", "day", "dusk", "night"];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Luminance relative (WCAG), pour savoir si un ciel est clair. */
export function luminance(hex: string): number {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Écrit la palette (`--ink-night`, `--firefly-gold`…) sur l'élément racine. */
export function applyPalette(root: HTMLElement = document.documentElement): void {
  for (const [id, c] of Object.entries(theme.colors)) root.style.setProperty(`--${id}`, c.hex);
  for (const [id, c] of Object.entries(theme.derived)) root.style.setProperty(`--${id}`, c.hex);
}

/** Écrit les variables propres à un ciel (texte, panneaux, mousse). */
export function applySkyVars(id: SkyId, root: HTMLElement = document.documentElement): void {
  const sky = theme.skies[id];
  const set = (k: string, v: string): void => root.style.setProperty(k, v);
  set("--text", sky.text);
  set("--text-soft", sky.textMuted);
  set("--panel", rgba(sky.panel, sky.panelOpacity));
  set("--panel-edge", rgba(sky.panelEdge, 0.4));
  set("--moss-1", sky.moss[0]);
  set("--moss-2", sky.moss[1]);
  set("--mist", sky.mist);
  root.dataset["sky"] = id;
  root.dataset["tone"] = luminance(sky.text) < 0.3 ? "light" : "dark";
}

export function skyGradient(sky: SkySpec): string {
  const stops = sky.gradient.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(", ");
  return `linear-gradient(${sky.gradient.angle}deg, ${stops})`;
}

function toMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes écoulées depuis minuit local (0 à 1439) pour une heure UTC et un décalage local. */
export function localMinutes(nowMs: number, utcOffsetMin: number): number {
  const m = Math.floor(nowMs / 60_000) + utcOffsetMin;
  return ((m % 1440) + 1440) % 1440;
}

export interface SkyMix {
  /** Ciel de l'heure (celui qui donne le texte et les panneaux). */
  current: SkyId;
  /** Ciel voisin avec lequel on fond, ou null. Il est peint dessous. */
  neighbor: SkyId | null;
  /** Part du voisin dans le mélange, de 0 à 0,5 : le ciel courant est peint dessus à (1 − part). */
  neighborShare: number;
  /** Intensité des étoiles (mélange des deux ciels). */
  stars: number;
}

/**
 * Ciel pour une heure locale. Le fondu dure `skyCrossfadeMinutes`, centré sur la frontière entre deux
 * fenêtres : à la frontière, moitié-moitié ; le résultat est continu.
 */
export function skyAt(minute: number, spec: ThemeSpec = theme): SkyMix {
  const half = spec.skyCrossfadeMinutes / 2;
  let index = SKY_ORDER.findIndex((id) => {
    const w = spec.skies[id].window;
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
  });
  if (index < 0) index = SKY_ORDER.length - 1;
  const n = SKY_ORDER.length;
  const current = SKY_ORDER[index] as SkyId;
  const w = spec.skies[current].window;
  const sinceStart = (minute - toMinutes(w.from) + 1440) % 1440;
  const untilEnd = (toMinutes(w.to) - minute + 1440) % 1440;

  let neighbor: SkyId | null = null;
  let share = 0;
  if (sinceStart < half) {
    neighbor = SKY_ORDER[(index - 1 + n) % n] as SkyId;
    share = 0.5 * (1 - sinceStart / half);
  } else if (untilEnd <= half) {
    neighbor = SKY_ORDER[(index + 1) % n] as SkyId;
    share = 0.5 * (1 - untilEnd / half);
  }
  const stars =
    spec.skies[current].stars * (1 - share) + (neighbor ? spec.skies[neighbor].stars * share : 0);
  return { current, neighbor, neighborShare: neighbor ? share : 0, stars };
}
