// Interface de sauvegarde (D2) et fonctions communes de format de fichier.
import { migrate, MigrationError } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";

export interface SaveStore {
  /** Charge et migre la sauvegarde ; `null` s'il n'y en a pas. Lève `MigrationError` si illisible. */
  load(): Promise<SaveState | null>;
  /** `notify: false` : écriture sans prévenir les autres onglets (sauvegardes périodiques). */
  save(state: SaveState, opts?: { notify?: boolean }): Promise<void>;
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

/** Analyse un texte JSON et le migre ; toute erreur devient une `MigrationError`. */
export function parseSave(text: string): SaveState {
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
