// Types publics des règles (Annexe A1 et A2 de docs/decisions.md).

export type Stage = "egg" | "baby" | "child" | "teen" | "adult";
export const STAGES: readonly Stage[] = ["egg", "baby", "child", "teen", "adult"];

export type Gauge = "satiety" | "happiness" | "energy" | "hygiene" | "health";
export type Need = "satiety" | "hygiene" | "happiness" | "energy" | "sick" | "weak";
export type Life = "alive" | "flown";

/** Espèce de la créature (D6) : purement visuelle, tirée à la naissance. */
export type Kind = "kawaii" | "feerique";
export const KINDS: readonly Kind[] = ["kawaii", "feerique"];

/** Le temps est une entrée : millisecondes UTC entières + décalage local en minutes. */
export type Time = { nowMs: number; utcOffsetMin: number };

export type Action =
  | { type: "tick" }
  | { type: "feed"; food: "meal" | "snack" }
  | { type: "play" }
  | { type: "clean" }
  | { type: "heal" }
  | { type: "sleep" }
  | { type: "wake" }
  | { type: "pet" }
  | { type: "rebirth"; id: string; name: string; seed: number; kind?: Kind }; // `kind` : force l'espèce (sans tirage)

export type GameEvent =
  | { type: "stageChanged"; from: Stage; to: Stage }
  | { type: "becameSick" }
  | { type: "recovered" }
  | { type: "fellAsleep" }
  | { type: "wokeUp" }
  | { type: "weakened" }
  | { type: "recoveredStrength" }
  | { type: "flewAway" }
  | { type: "reborn" }
  | { type: "needAppeared"; need: Need }
  | { type: "needResolved"; need: Need }
  | { type: "clockAdjusted"; deltaMs: number } // horloge reculée : chronologie de l'animal translatée (deltaMs < 0)
  | { type: "actionRefused"; action: Action["type"]; reason: string };

export type Gauges = Record<Gauge, number>;

export interface PetStatus {
  asleep: boolean;
  asleepSince: number | null;
  sick: boolean;
  sickSince: number | null;
  messes: number;
  messProgressSeconds: number;
  weakSince: number | null;
}

/** Clés de `cooldowns` : instant (ms) avant lequel l'action est refusée ; 0 = disponible. */
export type CooldownKey = "feed.meal" | "feed.snack" | "heal" | "pet";

export interface Pet {
  id: string;
  name: string;
  bornAt: number;
  kind: Kind;
  stage: Stage;
  stageSince: number;
  life: Life;
  flownAt: number | null;
  gauges: Gauges;
  status: PetStatus;
  cooldowns: Record<string, number>;
  lastUpdatedAt: number;
  rng: number;
}

export interface AlbumEntry {
  id: string;
  name: string;
  bornAt: number;
  flownAt: number;
  stage: Stage;
  kind: Kind;
}

export interface Settings {
  reducedMotion: "system" | "on" | "off";
  sound: boolean;
  notifications: boolean;
}

export interface SaveState {
  version: number;
  savedAt: number;
  pet: Pet;
  album: AlbumEntry[];
  settings: Settings;
}

export type PrimaryState = "happy" | "hungry" | "tired" | "sick" | "asleep" | "dirty" | "weak" | "flown";
export type GaugeLevel = "ok" | "low" | "critical";

export interface View {
  kind: Kind;
  primary: PrimaryState;
  secondary: Need[];
  gaugeLevels: Record<Gauge, GaugeLevel>;
}

export interface Attention {
  at: number;
  need: Need;
}

/**
 * Notifications déjà envoyées, tenues par l'appelant (hors de la sauvegarde) et passées à
 * `nextAttentionAt`. L'appelant retire les entrées d'un besoin dès qu'il est résolu
 * (événement `needResolved`) ; les entrées de plus de 2 jours peuvent être purgées.
 */
export interface AttentionHistory {
  sent: Array<{ at: number; need: Need }>;
}
