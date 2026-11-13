import { assertBalance } from "./balance";
import type { Balance } from "./balance";
import { sanitizeNow } from "./advance";
import { drawKind, seedToState } from "./rng";
import { KINDS } from "./types";
import type { AlbumEntry, Kind, Pet, SaveState, Time } from "./types";

export const SAVE_VERSION = 2;

/** Espèce forcée invalide passée à `createSave` (erreur de développement, comme `BalanceError`). */
export class InvalidKindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKindError";
  }
}

export function isKind(v: unknown): v is Kind {
  return KINDS.some((k) => k === v);
}

export interface PetInput {
  id: string;
  name: string;
  seed: number;
  /** Force l'espèce (tests, débogage) : aucun tirage n'est consommé. */
  kind?: Kind | undefined;
}

/** Naissance à l'instant `nowMs` (entier ; `lastUpdatedAt` = `bornAt` : premier point de la grille). */
export function createPet(input: PetInput, nowMs: number, b: Balance): Pet {
  const g = b.gauges;
  // Espèce (D6) : forcée (aucun tirage, `rng` = état de la graine) ou tirée avec UN tirage de mulberry32.
  const seedState = seedToState(input.seed);
  let kind: Kind;
  let rng = seedState;
  if (input.kind !== undefined) kind = input.kind;
  else {
    const d = drawKind(seedState, b.kinds);
    kind = d.id as Kind;
    rng = d.state;
  }
  return {
    id: input.id,
    name: input.name,
    kind,
    bornAt: nowMs,
    stage: "egg",
    stageSince: nowMs,
    life: "alive",
    flownAt: null,
    gauges: {
      satiety: g.satiety.initial,
      happiness: g.happiness.initial,
      energy: g.energy.initial,
      hygiene: g.hygiene.initial,
      health: g.health.initial,
    },
    status: {
      asleep: false,
      asleepSince: null,
      sick: false,
      sickSince: null,
      messes: 0,
      messProgressSeconds: 0,
      weakSince: null,
    },
    cooldowns: { "feed.meal": 0, "feed.snack": 0, heal: 0, pet: 0 },
    lastUpdatedAt: nowMs,
    rng,
  };
}

/**
 * `nowMs` fractionnaire : arrondi à l'entier inférieur ; non fini : 0. `seed` : normalisée en
 * entier 32 bits non signé. Lève `BalanceError` si la balance est invalide et `InvalidKindError`
 * si `input.kind` est fourni mais n'est pas une espèce connue.
 */
export function createSave(input: PetInput, time: Time, balance: Balance): SaveState {
  assertBalance(balance);
  if (input.kind !== undefined && !isKind(input.kind)) throw new InvalidKindError(`espèce inconnue : ${String(input.kind)}`);
  const floored = sanitizeNow(time.nowMs, Number.NEGATIVE_INFINITY);
  const nowMs = Number.isFinite(floored) ? floored : 0;
  return {
    version: SAVE_VERSION,
    savedAt: nowMs,
    pet: createPet(input, nowMs, balance),
    album: [],
    settings: { reducedMotion: "system", sound: true, notifications: false },
  };
}

function cloneAlbumEntry(e: AlbumEntry): AlbumEntry {
  return { id: e.id, name: e.name, bornAt: e.bornAt, flownAt: e.flownAt, stage: e.stage, kind: e.kind };
}

/** Copie profonde : les règles ne modifient jamais l'état reçu. */
export function cloneSave(s: SaveState): SaveState {
  const p = s.pet;
  return {
    version: s.version,
    savedAt: s.savedAt,
    pet: {
      id: p.id,
      name: p.name,
      kind: p.kind,
      bornAt: p.bornAt,
      stage: p.stage,
      stageSince: p.stageSince,
      life: p.life,
      flownAt: p.flownAt,
      gauges: { ...p.gauges },
      status: { ...p.status },
      cooldowns: { ...p.cooldowns },
      lastUpdatedAt: p.lastUpdatedAt,
      rng: p.rng,
    },
    album: s.album.map(cloneAlbumEntry),
    settings: { ...s.settings },
  };
}
