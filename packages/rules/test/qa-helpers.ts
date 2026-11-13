// Outils partagés des tests QA (fichiers qa-*.test.ts). Aucune horloge réelle : le temps est injecté.
import { createSave, defaultBalance } from "../src/index";
import type { Balance, SaveState, Time } from "../src/index";
import { mergePatch } from "./scenario-runner";

export const B: Balance = defaultBalance;
export const T0 = 1763020800000; // 2025-11-13 08:00:00 UTC
export const H = 3600000;
export const MIN = 60000;
export const ID = "00000000-0000-4000-8000-0000000000aa";
/** Graine « malchance » : premier tirage ~ 0, maladie dès que possible. */
export const WORST = 14056;
/** Graine « chance » : les 4 800 premiers tirages sont élevés, jamais malade. */
export const NEVER = 11184255;

/** `kind` forcé à kawaii : aucun tirage d'espèce, donc `pet.rng` = graine (séquence de maladie inchangée, D6). */
export function fresh(seed = NEVER, patch?: object, balance: Balance = B, nowMs = T0): SaveState {
  const s = createSave({ id: ID, name: "Lumi", seed, kind: "kawaii" }, { nowMs, utcOffsetMin: 0 }, balance);
  return patch ? (mergePatch(s, patch) as SaveState) : s;
}

export const at = (ms: number, utcOffsetMin = 0): Time => ({ nowMs: T0 + ms, utcOffsetMin });

/** Gèle un objet en profondeur : toute mutation lève une TypeError (modules ESM = mode strict). */
export function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Petit générateur pour les tests (indépendant des règles). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Santé de l'invariant « jauges bornées et finies ». */
export function gaugesOk(s: SaveState): string | null {
  for (const [k, v] of Object.entries(s.pet.gauges)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return `${k} non fini : ${String(v)}`;
    if (v < 0 || v > 100) return `${k} hors bornes : ${v}`;
  }
  const m = s.pet.status.messes;
  if (!Number.isInteger(m) || m < 0 || m > B.messes.max) return `messes invalide : ${m}`;
  const p = s.pet.status.messProgressSeconds;
  if (!Number.isFinite(p) || p < 0) return `messProgressSeconds invalide : ${p}`;
  const r = s.pet.rng;
  if (!Number.isInteger(r) || r < 0 || r > 4294967295) return `rng invalide : ${r}`;
  if (!Number.isFinite(s.pet.lastUpdatedAt) || !Number.isFinite(s.savedAt)) return "horodatage non fini";
  return null;
}
