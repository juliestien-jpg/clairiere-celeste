// Présentation de l'album des créatures envolées : dates, durée de vie, stade, position des étoiles.
import type { AlbumEntry, Stage } from "@tamagoshi/rules";

export const STAGE_LABEL: Record<Stage, string> = {
  egg: "œuf",
  baby: "bébé",
  child: "enfant",
  teen: "adolescent",
  adult: "adulte",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Durée de vie en toutes lettres : « moins d'une heure », « 5 heures », « 3 jours et 4 heures ». */
export function formatLifespan(ms: number): string {
  if (!Number.isFinite(ms) || ms < HOUR) return "moins d'une heure";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const h = `${hours} heure${hours > 1 ? "s" : ""}`;
  const d = `${days} jour${days > 1 ? "s" : ""}`;
  if (days === 0) return h;
  return hours === 0 ? d : `${d} et ${h}`;
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function lifespanOf(e: Pick<AlbumEntry, "bornAt" | "flownAt">): number {
  return Math.max(0, e.flownAt - e.bornAt);
}

export interface StarPoint {
  /** Pourcentages dans le ciel. */
  left: number;
  top: number;
}

/**
 * Répartition des étoiles : spirale de tournesol (angle d'or), donc jamais deux étoiles collées, même nombreuses,
 * avec un léger décalage propre à chaque identifiant pour que le ciel paraisse naturel. Déterministe.
 */
export function starPoints(entries: readonly Pick<AlbumEntry, "id">[]): StarPoint[] {
  const n = entries.length;
  return entries.map((e, i) => {
    let h = 2166136261;
    for (let k = 0; k < e.id.length; k++) h = Math.imul(h ^ e.id.charCodeAt(k), 16777619);
    const jitterA = (((h >>> 0) % 1000) / 1000 - 0.5) * 0.25;
    const jitterR = (((Math.imul(h, 2246822519) >>> 0) % 1000) / 1000 - 0.5) * 0.06;
    const angle = i * 2.399963 + jitterA;
    const radius = Math.min(1, Math.sqrt((i + 0.6) / (n + 0.2)) + jitterR);
    return { left: 50 + Math.cos(angle) * radius * 40, top: 50 + Math.sin(angle) * radius * 38 };
  });
}

/** Position d'une étoile du ciel de l'Envol (écran du ciel, un seul rang de créatures) : hachage de l'identifiant. */
export function starPosition(id: string, i: number): { left: string; top: string } {
  let h = 2166136261 ^ i;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  const a = (h >>> 0) % 1000;
  const b = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
  return { left: `${8 + (a / 1000) * 84}%`, top: `${6 + ((b % 1000) / 1000) * 58}%` };
}
