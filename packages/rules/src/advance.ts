// Passage du temps : pas fixes (docs/equilibrage.md, sections 3.2 et 3.3).
// Arithmétique autorisée : + - * / min max clamp, comparaisons (D1). Ordre des opérations
// volontairement identique à la spécification : variation = vitesse * dt / 3600.
import type { Balance } from "./balance";
import { nextRandom } from "./rng";
import { STAGES } from "./types";
import type { GameEvent, Need, Pet, Stage } from "./types";

const SECONDS_PER_HOUR = 3600;
const MS_PER_HOUR = 3600000;

export function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** Ordre des bits de `needMask`, aussi ordre d'émission des événements de besoin. */
export const NEED_BITS: readonly Need[] = ["satiety", "hygiene", "happiness", "energy", "sick", "weak"];

/** Besoins actifs (niveau « bas » ou pire, maladie, affaiblie), sous forme de masque de bits. */
export function needMask(p: Pet, b: Balance): number {
  const g = p.gauges;
  const c = b.gauges;
  let m = 0;
  if (g.satiety <= c.satiety.low) m |= 1;
  if (g.hygiene <= c.hygiene.low) m |= 2;
  if (g.happiness <= c.happiness.low) m |= 4;
  if (g.energy <= c.energy.low) m |= 8;
  if (p.status.sick) m |= 16;
  if (p.status.weakSince !== null) m |= 32;
  return m;
}

export function pushNeedEvents(before: number, after: number, ev: GameEvent[]): void {
  for (let i = 0; i < NEED_BITS.length; i++) {
    const bit = 1 << i;
    const need = NEED_BITS[i];
    if (need === undefined) continue;
    const was = (before & bit) !== 0;
    const is = (after & bit) !== 0;
    if (!was && is) ev.push({ type: "needAppeared", need });
    else if (was && !is) ev.push({ type: "needResolved", need });
  }
}

/** Réévalue l'état « affaiblie » (étape 7 de 3.3, aussi appelée après une action). */
export function evalWeak(p: Pet, b: Balance, nowMs: number, ev: GameEvent[] | null): void {
  const h = p.gauges.health;
  if (p.status.weakSince === null) {
    if (h <= b.envol.weakWhenHealthAtOrBelow) {
      p.status.weakSince = nowMs;
      ev?.push({ type: "weakened" });
    }
  } else if (h > b.envol.recoverWhenHealthAbove) {
    p.status.weakSince = null;
    ev?.push({ type: "recoveredStrength" });
  }
}

/** Un pas de `dtMs` millisecondes (3.3). Fait avancer `lastUpdatedAt` de `dtMs`. */
export function stepPet(p: Pet, dtMs: number, b: Balance, ev: GameEvent[] | null): void {
  if (p.life === "flown") return;
  const before = ev !== null ? needMask(p, b) : 0;
  const dt = dtMs / 1000;
  const g = p.gauges;
  const st = p.status;
  const c = b.gauges;
  p.lastUpdatedAt += dtMs;
  const end = p.lastUpdatedAt;

  // 1. Jauges
  if (!st.asleep) {
    g.satiety -= (c.satiety.decayPerHour * dt) / SECONDS_PER_HOUR;
    g.happiness -= (c.happiness.decayPerHour * dt) / SECONDS_PER_HOUR;
    g.energy -= (c.energy.decayPerHour * dt) / SECONDS_PER_HOUR;
    g.hygiene -= (c.hygiene.decayPerHour * dt) / SECONDS_PER_HOUR;
    // 2. Salissures (éveillé seulement)
    if (st.messes < b.messes.max) {
      st.messProgressSeconds += dt;
      const period = b.messes.everyHoursAwake * SECONDS_PER_HOUR;
      if (st.messProgressSeconds >= period) {
        st.messProgressSeconds -= period;
        st.messes += 1;
        g.hygiene -= c.hygiene.decayPerMess;
      }
    }
  } else {
    g.satiety -= (c.satiety.decayPerHourAsleep * dt) / SECONDS_PER_HOUR;
    g.happiness -= (c.happiness.decayPerHourAsleep * dt) / SECONDS_PER_HOUR;
    g.hygiene -= (c.hygiene.decayPerHourAsleep * dt) / SECONDS_PER_HOUR;
    g.energy += (c.energy.regenPerHourAsleep * dt) / SECONDS_PER_HOUR;
  }
  // 3. Bornes
  g.satiety = clamp(g.satiety);
  g.happiness = clamp(g.happiness);
  g.energy = clamp(g.energy);
  g.hygiene = clamp(g.hygiene);

  // 4. Sommeil
  if (st.asleep && g.energy >= b.sleep.wakeAtOrAboveEnergy) {
    st.asleep = false;
    st.asleepSince = null;
    ev?.push({ type: "wokeUp" });
  } else if (!st.asleep && g.energy <= b.sleep.autoSleepAtOrBelowEnergy) {
    st.asleep = true;
    st.asleepSince = end;
    ev?.push({ type: "fellAsleep" });
  }

  // 5. Maladie : un seul tirage par pas, seulement si la chance est non nulle
  if (!st.sick) {
    let chance = 0;
    if (g.hygiene <= c.hygiene.critical) chance += b.sickness.chancePerHourWhenHygieneCritical;
    if (g.satiety <= c.satiety.critical) chance += b.sickness.chancePerHourWhenSatietyCritical;
    if (chance > 0) {
      const r = nextRandom(p.rng);
      p.rng = r.state;
      if (r.value < (chance * dt) / SECONDS_PER_HOUR) {
        st.sick = true;
        st.sickSince = end;
        ev?.push({ type: "becameSick" });
      }
    }
  }

  // 6. Santé
  const criticalVital =
    g.satiety <= c.satiety.critical || g.hygiene <= c.hygiene.critical || g.happiness <= c.happiness.critical;
  if (criticalVital) g.health -= (c.health.decayPerHourWhenCritical * dt) / SECONDS_PER_HOUR;
  if (st.sick) g.health -= (c.health.decayPerHourWhenSick * dt) / SECONDS_PER_HOUR;
  if (!criticalVital && !st.sick) g.health += (c.health.regenPerHourWhenWell * dt) / SECONDS_PER_HOUR;
  g.health = clamp(g.health);

  // 7. Envol / affaiblie
  if (g.health <= b.envol.flyWhenHealthAtOrBelow) {
    p.life = "flown";
    p.flownAt = end;
    ev?.push({ type: "flewAway" });
    return;
  }
  evalWeak(p, b, end, ev);

  if (ev !== null) pushNeedEvents(before, needMask(p, b), ev);
}

function stageThresholdMs(minAgeHours: number): number {
  return Math.round(minAgeHours * MS_PER_HOUR);
}

function asStage(id: string): Stage | null {
  return STAGES.find((s) => s === id) ?? null;
}

/** Fait monter le stade selon l'âge réel à l'instant `atMs` ; un événement par palier franchi. */
export function updateStage(p: Pet, atMs: number, b: Balance, ev: GameEvent[] | null): void {
  const list = b.stages;
  let idx = list.findIndex((s) => s.id === p.stage);
  if (idx < 0) return;
  const age = atMs - p.bornAt;
  for (let i = idx + 1; i < list.length; i++) {
    const next = list[i];
    const prev = list[i - 1];
    if (next === undefined || prev === undefined) break;
    if (stageThresholdMs(next.minAgeHours) > age) break;
    const from = asStage(prev.id);
    const to = asStage(next.id);
    if (from === null || to === null) break;
    ev?.push({ type: "stageChanged", from, to });
    p.stage = to;
    p.stageSince = p.bornAt + stageThresholdMs(next.minAgeHours);
    idx = i;
  }
}

/**
 * Heure d'entrée normalisée : non finie (NaN, ±Infinity) ou non numérique -> `floorMs` (heure
 * « reculée », rien n'avance) ; fractionnaire -> arrondie à l'entier inférieur ; jamais < `floorMs`.
 */
export function sanitizeNow(nowMs: number, floorMs: number): number {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return floorMs;
  return Math.max(Math.floor(nowMs), floorMs);
}

/** Dernier point de la grille `bornAt + k * step` (en pratique `lastUpdatedAt + k * step`) <= `nowMs`. */
export function gridPoint(p: Pet, nowMs: number, b: Balance): number {
  const stepMs = b.catchUp.stepSeconds * 1000;
  const now = sanitizeNow(nowMs, p.lastUpdatedAt);
  return p.lastUpdatedAt + Math.floor((now - p.lastUpdatedAt) / stepMs) * stepMs;
}

/** Premier point de la grille de l'animal >= `t`. */
export function gridCeil(p: Pet, t: number, b: Balance): number {
  const stepMs = b.catchUp.stepSeconds * 1000;
  return p.bornAt + Math.ceil((t - p.bornAt) / stepMs) * stepMs;
}

/**
 * Rattrape le temps jusqu'à `nowMs` sur la grille fixe `bornAt + k * stepSeconds` : on avance
 * par pas entiers jusqu'au dernier point de grille <= `nowMs` (le reste est reporté à l'appel
 * suivant), donc `lastUpdatedAt` reste toujours sur la grille. N'importe quel découpage d'une
 * absence donne le même état, le même `rng` et les mêmes événements.
 *
 * Plafond `catchUp.maxSeconds` **par appel** : au plus floor(max / pas) pas sont rejoués, le temps
 * au-delà est offert (`lastUpdatedAt` saute au point de grille final). Si l'animal s'envole, on
 * s'arrête : `lastUpdatedAt` reste à l'instant de l'Envol. Les `stageChanged` sont émis au pas où le seuil d'âge est franchi.
 */
export function catchUp(p: Pet, nowMs: number, b: Balance, ev: GameEvent[] | null): void {
  const stepMs = b.catchUp.stepSeconds * 1000;
  const target = gridPoint(p, nowMs, b);
  const maxSteps = Math.max(1, Math.floor((b.catchUp.maxSeconds * 1000) / stepMs));
  let n = Math.min(Math.round((target - p.lastUpdatedAt) / stepMs), maxSteps);
  while (n > 0 && p.life === "alive") {
    stepPet(p, stepMs, b, ev);
    updateStage(p, p.lastUpdatedAt, b, ev);
    n -= 1;
  }
  if (p.life === "alive" && p.lastUpdatedAt < target) {
    // temps offert au-delà du plafond : l'horloge saute au point de grille final, l'âge reste réel
    p.lastUpdatedAt = target;
    updateStage(p, target, b, ev);
  }
  // Animal envolé : l'horloge s'arrête à l'Envol (`lastUpdatedAt` = `flownAt`, sur la grille), ce qui
  // rend l'état final indépendant du découpage de l'absence.
}
