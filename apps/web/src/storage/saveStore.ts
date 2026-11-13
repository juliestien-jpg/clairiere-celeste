// Interface de sauvegarde (D2) et fonctions communes de format de fichier.
import { migrate, MigrationError, SAVE_VERSION } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";

/** Taille maximale d'un fichier de sauvegarde importé (une sauvegarde réelle fait quelques Ko). */
export const MAX_IMPORT_BYTES = 256 * 1024;

/** Résultat d'une écriture : écrite, ou refusée parce que le stockage contient une version plus récente (D2). */
export type SaveOutcome = { status: "saved" } | { status: "newer"; state: SaveState };

export interface SaveOptions {
  /** `false` : écriture sans prévenir les autres onglets (sauvegardes périodiques). */
  notify?: boolean;
  /** Écrase même une version stockée plus récente (import, nouvelle partie voulus par le joueur). */
  force?: boolean;
}

export interface SaveStore {
  /** Charge et migre la sauvegarde ; `null` s'il n'y en a pas. Lève `MigrationError` si illisible. */
  load(): Promise<SaveState | null>;
  /** Contenu stocké tel quel (JSON), sans migration ni validation, pour l'exporter ; `null` s'il n'y en a pas. */
  readRaw(): Promise<string | null>;
  /**
   * Relit avant d'écrire (D2) : si la version stockée est plus récente que `state`, rien n'est écrit et elle est
   * rendue. Lève `MigrationError` si le stockage contient une sauvegarde qu'on ne sait pas lire (jamais écrasée sans `force`).
   */
  save(state: SaveState, opts?: SaveOptions): Promise<SaveOutcome>;
  clear(): Promise<void>;
  exportFile(state: SaveState): Blob;
  importFile(file: Blob): Promise<SaveState>;
  /** Appelé quand un autre onglet a écrit ou effacé la sauvegarde. */
  subscribe(listener: () => void): () => void;
  /** `navigator.storage.persist()` ; `false` si indisponible ou refusé. */
  requestPersistence(): Promise<boolean>;
}

export function serializeSave(state: SaveState): string {
  return JSON.stringify(state, null, 2);
}

export function exportFileFrom(state: SaveState): Blob {
  return new Blob([serializeSave(state)], { type: "application/json" });
}

/** Contenu brut (valeur stockée) sérialisé pour l'export : aucune transformation du contenu. */
export function serializeRaw(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2) ?? "null";
  } catch {
    return String(raw);
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Compare la valeur stockée à l'état qu'on s'apprête à écrire, sans la migrer :
 * - `ok` : on peut écrire (rien de stocké, ou version stockée pas plus récente) ;
 * - `newer` : la version stockée est plus récente (`savedAt`, puis `pet.lastUpdatedAt`) ;
 * - `tooNew` : le stockage vient d'une version plus récente du jeu ; ne jamais l'écraser ;
 * - `unreadable` : contenu qu'on ne comprend pas ; ne jamais l'écraser sans demande explicite.
 */
export function compareStored(raw: unknown, state: SaveState): "ok" | "newer" | "tooNew" | "unreadable" {
  if (raw === undefined || raw === null) return "ok";
  if (typeof raw !== "object") return "unreadable";
  const o = raw as Record<string, unknown>;
  const version = num(o["version"]);
  if (version === null) return "unreadable";
  if (version > SAVE_VERSION) return "tooNew";
  const pet = o["pet"];
  const storedSavedAt = num(o["savedAt"]);
  const storedUpdated = typeof pet === "object" && pet !== null ? num((pet as Record<string, unknown>)["lastUpdatedAt"]) : null;
  if (storedSavedAt === null || storedUpdated === null) return "unreadable";
  if (storedSavedAt > state.savedAt) return "newer";
  if (storedSavedAt === state.savedAt && storedUpdated > state.pet.lastUpdatedAt) return "newer";
  return "ok";
}

/** Transforme un verdict de `compareStored` en erreur typée, ou `null` si l'écriture est possible. */
export function refusalFor(verdict: ReturnType<typeof compareStored>): MigrationError | null {
  if (verdict === "tooNew") return new MigrationError("unsupportedVersion", "la sauvegarde stockée vient d'une version plus récente du jeu");
  if (verdict === "unreadable") return new MigrationError("invalid", "la sauvegarde stockée est illisible");
  return null;
}

/** Analyse un texte JSON et le migre ; toute erreur devient une `MigrationError`. */
export function parseSave(text: string): SaveState {
  if (text.length > MAX_IMPORT_BYTES) throw new MigrationError("invalid", "fichier trop volumineux");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MigrationError("invalid", "le fichier n'est pas du JSON valide");
  }
  return migrate(raw);
}

export function exportFileName(state: SaveState): string {
  const safe = state.pet.name.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "animal";
  return `tamagoshi-${safe}.json`;
}

/** Refuse un fichier trop gros avant même de le lire. */
export function assertImportSize(file: Blob): void {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new MigrationError("invalid", `fichier trop volumineux (${Math.round(file.size / 1024)} Ko, maximum ${MAX_IMPORT_BYTES / 1024} Ko)`);
  }
}
