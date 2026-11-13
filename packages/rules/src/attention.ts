// Prochain besoin réel (D5, docs/equilibrage.md section 3.9).
//
// On avance l'animal sans action sur la grille fixe de temps (générateur aléatoire copié : la
// maladie est donc prédite avec certitude), et on cherche la première notification :
//  - un besoin « notifiable » apparu après l'instant d'appel (les besoins déjà actifs sont
//    supposés connus du joueur, sauf si `history` est fourni : voir ci-dessous) ;
//  - un besoin ordinaire apparu pendant les heures calmes est reporté à leur fin ; un besoin
//    de `alwaysNotify` (« weak ») n'est jamais reporté par les heures calmes ni par l'espacement ;
//  - les besoins ordinaires apparus avant l'envoi sont regroupés ; `need` est le plus pressant.
// Avec `history` (notifications déjà envoyées, tenues par l'appelant) : un besoin actif mais
// jamais envoyé reste dû ; l'espacement `minGapMinutes` après le dernier envoi et le plafond
// `maxPerDay` par jour local (dont `reservedForAlwaysNotify` gardé pour `alwaysNotify`) sont
// appliqués. Sans `history`, ni espacement ni plafond (rien n'est connu), comme avant.
// L'instant renvoyé est toujours un point de la grille de l'animal.
import { catchUp, gridCeil, stepPet } from "./advance";
import { assertBalance } from "./balance";
import type { Balance } from "./balance";
import { cloneSave } from "./state";
import type { Attention, AttentionHistory, Need, Pet, SaveState, Time } from "./types";

function isFlown(p: Pet): boolean {
  return p.life === "flown";
}

const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

/** Du plus pressant au moins pressant. */
const PRIORITY: readonly Need[] = ["weak", "sick", "satiety", "hygiene", "happiness", "energy"];

function parseClock(hhmm: string): number {
  const parts = hhmm.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return (h * 60 + m) * MS_PER_MINUTE;
}

function isNeed(s: string): s is Need {
  return PRIORITY.some((n) => n === s);
}

/** Début (ms UTC) du jour local contenant `t`, et décalage local en ms. */
function localDayStart(t: number, utcOffsetMin: number): number {
  const local = t + utcOffsetMin * MS_PER_MINUTE;
  return Math.floor(local / MS_PER_DAY) * MS_PER_DAY - utcOffsetMin * MS_PER_MINUTE;
}

/** Premier instant >= t hors heures calmes (t lui-même s'il n'est pas dans les heures calmes). */
export function quietEnd(t: number, utcOffsetMin: number, from: string, to: string): number {
  const fromMs = parseClock(from);
  const toMs = parseClock(to);
  if (fromMs === toMs) return t;
  const dayStart = localDayStart(t, utcOffsetMin);
  const msOfDay = t - dayStart;
  if (fromMs > toMs) {
    // fenêtre qui passe minuit
    if (msOfDay >= fromMs) return dayStart + MS_PER_DAY + toMs;
    if (msOfDay < toMs) return dayStart + toMs;
    return t;
  }
  if (msOfDay >= fromMs && msOfDay < toMs) return dayStart + toMs;
  return t;
}

function notifiableFlags(p: Pet, b: Balance, needs: readonly Need[]): Need[] {
  const c = b.gauges;
  const useCritical = b.attention.notifyAt === "critical";
  const out: Need[] = [];
  for (const n of needs) {
    switch (n) {
      case "satiety":
        if (p.gauges.satiety <= (useCritical ? c.satiety.critical : c.satiety.low)) out.push(n);
        break;
      case "hygiene":
        if (p.gauges.hygiene <= (useCritical ? c.hygiene.critical : c.hygiene.low)) out.push(n);
        break;
      case "happiness":
        if (p.gauges.happiness <= (useCritical ? c.happiness.critical : c.happiness.low)) out.push(n);
        break;
      case "energy":
        if (p.gauges.energy <= (useCritical ? c.energy.critical : c.energy.low)) out.push(n);
        break;
      case "sick":
        if (p.status.sick) out.push(n);
        break;
      case "weak":
        if (p.status.weakSince !== null) out.push(n);
        break;
    }
  }
  return out;
}

/** Entrées valides de l'historique (instant fini, besoin connu). */
function readHistory(history: AttentionHistory | undefined): { at: number; need: Need }[] | null {
  if (history === undefined || history === null || !Array.isArray(history.sent)) return null;
  const out: { at: number; need: Need }[] = [];
  for (const e of history.sent) {
    if (typeof e === "object" && e !== null && typeof e.at === "number" && Number.isFinite(e.at) && isNeed(String(e.need))) {
      out.push({ at: e.at, need: e.need });
    }
  }
  return out;
}

export function nextAttentionAt(
  state: SaveState,
  time: Time,
  balance: Balance,
  history?: AttentionHistory,
): Attention | null {
  assertBalance(balance);
  const s = cloneSave(state);
  const p = s.pet;
  if (p.life === "flown") return null;
  const offset = typeof time.utcOffsetMin === "number" && Number.isFinite(time.utcOffsetMin) ? time.utcOffsetMin : 0;
  catchUp(p, time.nowMs, balance, null);
  if (isFlown(p)) return null;
  const t0 = p.lastUpdatedAt;

  const att = balance.attention;
  const always = att.alwaysNotify.filter(isNeed);
  const needs: Need[] = [...att.needs.filter(isNeed), ...always.filter((n) => !att.needs.includes(n))];
  const isAlways = (n: Need): boolean => always.includes(n);
  const sent = readHistory(history);
  const lastSent = sent === null ? Number.NEGATIVE_INFINITY : sent.reduce((m, e) => Math.max(m, e.at), Number.NEGATIVE_INFINITY);
  const gapMs = att.minGapMinutes * MS_PER_MINUTE;
  const toMs = parseClock(att.quietHours.to);
  const sentInDayOf = (t: number): number => {
    const d = localDayStart(t, offset);
    return sent === null ? 0 : sent.filter((e) => localDayStart(e.at, offset) === d).length;
  };

  /** Instant d'envoi d'un besoin ordinaire apparu en `at` (heures calmes, espacement, plafond), ou null. */
  const delayOrdinary = (at: number): number | null => {
    const cap = att.maxPerDay - att.reservedForAlwaysNotify;
    if (sent !== null && cap <= 0) return null;
    let t = at;
    for (let i = 0; i < 64; i++) {
      let u = quietEnd(t, offset, att.quietHours.from, att.quietHours.to);
      if (sent !== null) {
        u = Math.max(u, lastSent + gapMs);
        if (sentInDayOf(u) >= cap) u = localDayStart(u, offset) + MS_PER_DAY + toMs;
      }
      u = gridCeil(p, u, balance);
      if (u === t) return t;
      t = u;
    }
    return t;
  };
  /** Instant d'envoi d'un besoin de `alwaysNotify` : ni heures calmes ni espacement, mais le plafond total. */
  const delayAlways = (at: number): number | null => {
    if (sent === null) return at;
    if (att.maxPerDay <= 0) return null;
    let t = at;
    for (let i = 0; i < 64 && sentInDayOf(t) >= att.maxPerDay; i++) {
      t = gridCeil(p, localDayStart(t, offset) + MS_PER_DAY, balance);
    }
    return t;
  };

  /** Un besoin actif est « déjà signalé » s'il figure dans l'historique depuis son apparition. */
  const signaled = (n: Need): boolean => {
    if (sent === null) return true; // sans historique : les besoins déjà actifs sont supposés connus
    const since =
      n === "sick" ? (p.status.sickSince ?? Number.NEGATIVE_INFINITY) : n === "weak" ? (p.status.weakSince ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    return sent.some((e) => e.need === n && e.at >= since);
  };

  const horizon = t0 + Math.max(1, Math.floor((balance.catchUp.maxSeconds * 1000) / (balance.catchUp.stepSeconds * 1000))) * balance.catchUp.stepSeconds * 1000;
  const stepMs = balance.catchUp.stepSeconds * 1000;
  const occurrences: { need: Need; at: number }[] = [];
  const active0 = notifiableFlags(p, balance, needs);
  let known = new Set<Need>(active0);
  let candidate = Number.POSITIVE_INFINITY;
  let firstOrdinaryDone = false;

  const consider = (n: Need, at: number): void => {
    occurrences.push({ need: n, at });
    if (isAlways(n)) {
      const c = delayAlways(at);
      if (c !== null) candidate = Math.min(candidate, c);
    } else if (!firstOrdinaryDone) {
      firstOrdinaryDone = true;
      const c = delayOrdinary(at);
      if (c !== null) candidate = Math.min(candidate, c);
    }
  };

  for (const n of active0) if (!signaled(n)) consider(n, t0);

  while (!isFlown(p) && p.lastUpdatedAt < horizon && p.lastUpdatedAt < candidate) {
    stepPet(p, stepMs, balance, null);
    if (isFlown(p)) break;
    const now = notifiableFlags(p, balance, needs);
    for (const n of now) if (!known.has(n)) consider(n, p.lastUpdatedAt);
    known = new Set<Need>(now);
  }

  if (!Number.isFinite(candidate)) return null;
  const group = occurrences.filter((o) => o.at <= candidate).map((o) => o.need);
  for (const n of PRIORITY) {
    if (group.includes(n)) return { at: candidate, need: n };
  }
  return null;
}
