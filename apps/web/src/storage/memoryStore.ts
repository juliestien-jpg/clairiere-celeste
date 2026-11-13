// Sauvegarde en mémoire : tests, et repli quand IndexedDB est indisponible.
import { migrate } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { assertImportSize, compareStored, exportFileFrom, parseSave, refusalFor, serializeRaw } from "./saveStore";
import type { SaveOptions, SaveOutcome, SaveStore } from "./saveStore";

export class MemorySaveStore implements SaveStore {
  private data: unknown = null;
  private readonly listeners = new Set<() => void>();
  saveCount = 0;
  /** Pour les tests : fait échouer les écritures. */
  failWrites = false;

  async load(): Promise<SaveState | null> {
    return this.data === null ? null : migrate(structuredClone(this.data));
  }
  async readRaw(): Promise<string | null> {
    return this.data === null ? null : serializeRaw(this.data);
  }
  async save(state: SaveState, opts?: SaveOptions): Promise<SaveOutcome> {
    if (this.failWrites) throw new Error("écriture impossible (simulée)");
    if (!opts?.force) {
      const verdict = compareStored(this.data, state);
      const refusal = refusalFor(verdict);
      if (refusal) throw refusal;
      if (verdict === "newer") return { status: "newer", state: migrate(structuredClone(this.data)) };
    }
    this.data = structuredClone(state);
    this.saveCount++;
    if (opts?.notify !== false) this.listeners.forEach((l) => l());
    return { status: "saved" };
  }
  async clear(): Promise<void> {
    this.data = null;
    this.listeners.forEach((l) => l());
  }
  exportFile(state: SaveState): Blob {
    return exportFileFrom(state);
  }
  async importFile(file: Blob): Promise<SaveState> {
    assertImportSize(file);
    return parseSave(await file.text());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async requestPersistence(): Promise<boolean> {
    return false;
  }
  /** Pour les tests : injecte une valeur brute (par exemple une sauvegarde corrompue). */
  setRaw(raw: unknown): void {
    this.data = raw;
  }
}
