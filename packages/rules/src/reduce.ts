import { applyAction } from "./actions";
import { catchUp, evalWeak, needMask, pushNeedEvents, sanitizeNow, shiftPet, timelineShift } from "./advance";
import { assertBalance } from "./balance";
import type { Balance } from "./balance";
import { LIMITS, isValidId, isValidName } from "./limits";
import { cloneSave, createPet, isKind } from "./state";
import type { Action, GameEvent, SaveState, Time } from "./types";

const ACTION_TYPES: readonly string[] = ["tick", "feed", "play", "clean", "heal", "sleep", "wake", "pet", "rebirth"];

function refuse(events: GameEvent[], type: unknown, reason: string): void {
  events.push({ type: "actionRefused", action: (typeof type === "string" ? type : "unknown") as Action["type"], reason });
}

/**
 * Cœur des règles : (état, action, heure) -> état. Rattrape d'abord le temps écoulé sur la grille
 * fixe `bornAt + k * catchUp.stepSeconds` (voir `catchUp`), puis applique l'action à ce point de
 * grille. Pure : ne modifie pas `state`, ne lève jamais d'exception à cause de l'action ou de
 * l'heure (seule une balance invalide lève `BalanceError`).
 *
 * - heure antérieure d'au moins un pas à `lastUpdatedAt` (horloge de l'appareil remise en arrière) :
 *   translation de la chronologie de l'animal et événement `clockAdjusted` (voir A2), puis appel normal ;
 * - heure antérieure de moins d'un pas à `lastUpdatedAt`, non finie (NaN, ±Infinity) : le temps n'est pas rattrapé et
 *   l'action est appliquée à l'instant `lastUpdatedAt` (l'état ne recule jamais) ; heure
 *   fractionnaire : arrondie à l'entier inférieur ;
 * - action refusée : l'action n'a aucun effet, mais le temps déjà rattrapé reste acquis. Raisons
 *   possibles : voir `docs/decisions.md` A2 ;
 * - animal déjà envolé au départ : l'état est renvoyé inchangé (copie), seule `rebirth` est acceptée ;
 * - animal envolé pendant le rattrapage de cet appel : l'action est refusée (`flownDuringCatchUp`),
 *   `rebirth` comprise, pour que le joueur voie l'Envol ; un `tick` n'est pas refusé.
 */
export function reduce(
  state: SaveState,
  action: Action,
  time: Time,
  balance: Balance,
): { state: SaveState; events: GameEvent[] } {
  assertBalance(balance);
  const s = cloneSave(state);
  const p = s.pet;
  const events: GameEvent[] = [];
  const wasFlown = p.life === "flown";
  const rawType: unknown = typeof action === "object" && action !== null ? (action as { type?: unknown }).type : undefined;
  const nowMs = typeof time === "object" && time !== null ? time.nowMs : Number.NaN;
  // Horloge reculée d'au moins un pas : on translate la chronologie de l'animal (A2), sans simuler.
  const delta = timelineShift(p, nowMs, balance);
  if (delta !== 0) {
    shiftPet(p, delta);
    s.savedAt += delta;
    events.push({ type: "clockAdjusted", deltaMs: delta });
  }
  let now = sanitizeNow(nowMs, p.lastUpdatedAt);

  if (!wasFlown) {
    catchUp(p, now, balance, events);
    now = p.lastUpdatedAt; // point de grille (ou instant de l'Envol)
    s.savedAt = Math.max(s.savedAt, now);
  }

  if (typeof rawType !== "string" || !ACTION_TYPES.includes(rawType)) {
    refuse(events, rawType, "unknownAction");
    return { state: s, events };
  }

  if (p.life === "flown") {
    if (!wasFlown) {
      // Le joueur doit voir l'Envol avant de pouvoir faire renaître : `tick` seulement fait passer le temps.
      if (rawType !== "tick") refuse(events, rawType, "flownDuringCatchUp");
      return { state: s, events };
    }
    if (rawType !== "rebirth") {
      refuse(events, rawType, "flown");
      return { state: s, events };
    }
    const r = action as Extract<Action, { type: "rebirth" }>;
    if (!isValidId(r.id) || !isValidName(r.name) || (r.kind !== undefined && !isKind(r.kind))) {
      refuse(events, rawType, "invalidIdentity");
      return { state: s, events };
    }
    if (s.album.length >= LIMITS.albumMaxEntries) s.album.splice(0, s.album.length - LIMITS.albumMaxEntries + 1); // album plein : l'entrée la plus ancienne (index 0) est retirée
    s.album.push({
      id: p.id,
      name: p.name,
      bornAt: p.bornAt,
      flownAt: p.flownAt ?? p.lastUpdatedAt,
      stage: p.stage,
      kind: p.kind,
    });
    s.pet = createPet({ id: r.id, name: r.name, seed: r.seed, kind: r.kind }, now, balance);
    s.savedAt = Math.max(s.savedAt, now);
    events.push({ type: "reborn" });
    return { state: s, events };
  }

  if (rawType === "rebirth") {
    refuse(events, rawType, "notFlown");
    return { state: s, events };
  }
  if (rawType === "tick") return { state: s, events };
  if (rawType === "feed") {
    const food = (action as { food?: unknown }).food;
    if (food !== "meal" && food !== "snack") {
      refuse(events, rawType, "invalidAction");
      return { state: s, events };
    }
  }

  const before = needMask(p, balance);
  const reason = applyAction(p, action, now, balance, events);
  if (reason !== null) {
    refuse(events, rawType, reason);
    return { state: s, events };
  }
  evalWeak(p, balance, now, events);
  pushNeedEvents(before, needMask(p, balance), events);
  return { state: s, events };
}
