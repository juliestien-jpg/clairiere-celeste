// Lecture et migration d'une sauvegarde brute (Annexe A1). Fonctions pures.
// `migrate` enchaîne les migrations vN -> vN+1 jusqu'à la version courante, puis valide
// la forme obtenue. Toute sauvegarde illisible lève une `MigrationError` typée.
import { assertBalance, defaultBalance } from "./balance";
import type { Balance } from "./balance";
import { isKind, SAVE_VERSION } from "./state";
import { STAGES } from "./types";
import type { AlbumEntry, Kind, Pet, SaveState, Settings, Stage } from "./types";

export type MigrationErrorCode = "notAnObject" | "missingVersion" | "unsupportedVersion" | "invalid";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

type Raw = Record<string, unknown>;

/** Migrations indexées par version de départ : MIGRATIONS[1] transforme une v1 en v2, etc. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // v1 -> v2 (D6) : toutes les créatures existantes deviennent `kawaii`. `raw` est déjà une copie
  // profonde ; les éléments mal formés sont laissés tels quels (la validation finale les refuse).
  1: (raw) => {
    if (isRecord(raw["pet"])) raw["pet"]["kind"] = "kawaii";
    const album = raw["album"];
    if (Array.isArray(album)) {
      for (const e of album) if (isRecord(e)) e["kind"] = "kawaii";
    }
    return raw;
  },
};

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(path: string, what: string): never {
  throw new MigrationError("invalid", `${path} : ${what}`);
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fail(path, "nombre attendu");
  return v;
}
function int(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) return fail(path, "entier attendu");
  return n;
}
function gauge(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0 || n > 100) return fail(path, "entre 0 et 100 attendu");
  return n;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") return fail(path, "booléen attendu");
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== "string") return fail(path, "texte attendu");
  return v;
}
function intOrNull(v: unknown, path: string): number | null {
  return v === null ? null : int(v, path);
}
function obj(v: unknown, path: string): Raw {
  if (!isRecord(v)) return fail(path, "objet attendu");
  return v;
}
function idText(v: unknown, path: string): string {
  const t = str(v, path);
  if (t.length < 1) return fail(path, "texte non vide attendu");
  return t;
}
function stage(v: unknown, path: string): Stage {
  const found = STAGES.find((s) => s === v);
  if (found === undefined) return fail(path, "stade inconnu");
  return found;
}

function kind(v: unknown, path: string): Kind {
  if (!isKind(v)) return fail(path, "espèce inconnue (kawaii ou feerique attendu)");
  return v;
}

function readPet(raw: unknown, b: Balance): Pet {
  const p = obj(raw, "pet");
  const gauges = obj(p["gauges"], "pet.gauges");
  const status = obj(p["status"], "pet.status");
  const cds = obj(p["cooldowns"], "pet.cooldowns");
  const life = p["life"];
  if (life !== "alive" && life !== "flown") return fail("pet.life", "alive ou flown attendu");
  const cooldowns: Record<string, number> = {};
  for (const k of Object.keys(cds)) {
    const c = num(cds[k], `pet.cooldowns.${k}`);
    if (c < 0) return fail(`pet.cooldowns.${k}`, "positif attendu");
    cooldowns[k] = c;
  }
  const rng = int(p["rng"], "pet.rng");
  if (rng < 0 || rng > 4294967295) return fail("pet.rng", "entier 32 bits non signé attendu");
  const messProgress = num(status["messProgressSeconds"], "pet.status.messProgressSeconds");
  if (messProgress < 0) return fail("pet.status.messProgressSeconds", "positif attendu");
  const flownAt = intOrNull(p["flownAt"], "pet.flownAt");
  if ((life === "flown") !== (flownAt !== null)) return fail("pet.flownAt", "renseigné si et seulement si life vaut flown");
  const asleep = bool(status["asleep"], "pet.status.asleep");
  const asleepSince = intOrNull(status["asleepSince"], "pet.status.asleepSince");
  if (asleep !== (asleepSince !== null)) return fail("pet.status.asleepSince", "renseigné si et seulement si asleep");
  const messes = int(status["messes"], "pet.status.messes");
  if (messes < 0 || messes > b.messes.max) return fail("pet.status.messes", `entre 0 et ${b.messes.max} attendu`);
  const bornAt = int(p["bornAt"], "pet.bornAt");
  // Grille fixe : `lastUpdatedAt` est réaligné au point `bornAt + k * pas` inférieur (anciennes sauvegardes).
  const stepMs = b.catchUp.stepSeconds * 1000;
  const lastRaw = int(p["lastUpdatedAt"], "pet.lastUpdatedAt");
  const lastUpdatedAt = bornAt + Math.floor((lastRaw - bornAt) / stepMs) * stepMs;
  return {
    id: idText(p["id"], "pet.id"),
    name: str(p["name"], "pet.name"),
    kind: kind(p["kind"], "pet.kind"),
    bornAt,
    stage: stage(p["stage"], "pet.stage"),
    stageSince: int(p["stageSince"], "pet.stageSince"),
    life,
    flownAt,
    gauges: {
      satiety: gauge(gauges["satiety"], "pet.gauges.satiety"),
      happiness: gauge(gauges["happiness"], "pet.gauges.happiness"),
      energy: gauge(gauges["energy"], "pet.gauges.energy"),
      hygiene: gauge(gauges["hygiene"], "pet.gauges.hygiene"),
      health: gauge(gauges["health"], "pet.gauges.health"),
    },
    status: {
      asleep,
      asleepSince,
      sick: bool(status["sick"], "pet.status.sick"),
      sickSince: intOrNull(status["sickSince"], "pet.status.sickSince"),
      messes,
      messProgressSeconds: messProgress,
      weakSince: intOrNull(status["weakSince"], "pet.status.weakSince"),
    },
    cooldowns,
    lastUpdatedAt,
    rng,
  };
}

function readAlbum(raw: unknown): AlbumEntry[] {
  if (!Array.isArray(raw)) return fail("album", "tableau attendu");
  return raw.map((e: unknown, i: number) => {
    const o = obj(e, `album.${i}`);
    return {
      id: idText(o["id"], `album.${i}.id`),
      name: str(o["name"], `album.${i}.name`),
      bornAt: int(o["bornAt"], `album.${i}.bornAt`),
      flownAt: int(o["flownAt"], `album.${i}.flownAt`),
      stage: stage(o["stage"], `album.${i}.stage`),
      kind: kind(o["kind"], `album.${i}.kind`),
    };
  });
}

function readSettings(raw: unknown): Settings {
  const o = obj(raw, "settings");
  const rm = o["reducedMotion"];
  if (rm !== "system" && rm !== "on" && rm !== "off") return fail("settings.reducedMotion", "system, on ou off attendu");
  return { reducedMotion: rm, sound: bool(o["sound"], "settings.sound"), notifications: bool(o["notifications"], "settings.notifications") };
}

/** Copie profonde d'une valeur JSON (la sauvegarde reçue n'est jamais modifiée). */
function deepCopy(v: unknown, depth = 0): unknown {
  if (depth > 64) throw new MigrationError("invalid", "sauvegarde trop profonde");
  if (Array.isArray(v)) return v.map((x: unknown) => deepCopy(x, depth + 1));
  if (isRecord(v)) {
    const out: Raw = {};
    for (const k of Object.keys(v)) out[k] = deepCopy(v[k], depth + 1);
    return out;
  }
  return v;
}

/**
 * Lit une sauvegarde brute (JSON déjà analysé), la copie en profondeur (l'entrée n'est jamais
 * mutée), la migre vers la version courante et la valide aussi strictement que
 * `spec/save.schema.json` (les propriétés inconnues sont ignorées, pas refusées : compatibilité
 * ascendante). `balance` fournit `messes.max` et le pas de la grille de temps.
 */
export function migrate(raw: unknown, balance: Balance = defaultBalance): SaveState {
  assertBalance(balance);
  if (!isRecord(raw)) throw new MigrationError("notAnObject", "la sauvegarde doit être un objet");
  let current = deepCopy(raw) as Raw;
  let version = current["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new MigrationError("missingVersion", "champ version absent ou invalide");
  }
  if (version < 1 || version > SAVE_VERSION) {
    throw new MigrationError("unsupportedVersion", `version ${version} non prise en charge`);
  }
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (step === undefined) throw new MigrationError("unsupportedVersion", `aucune migration depuis la version ${version}`);
    current = step(current);
    version += 1;
    current["version"] = version;
  }
  return {
    version: SAVE_VERSION,
    savedAt: int(current["savedAt"], "savedAt"),
    pet: readPet(current["pet"], balance),
    album: readAlbum(current["album"]),
    settings: readSettings(current["settings"]),
  };
}
