// Sauvegarde en mémoire : tests, et repli quand IndexedDB est indisponible.
import { migrate } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { exportFileFrom, parseSave } from "./saveStore";
import type { SaveStore } from "./saveStore";

export class MemorySaveStore implements SaveStore {
  private data: unknown = null;
  private readonly listeners = new Set<() => void>();
  saveCount = 0;

  async load(): Promise<SaveState | null> {
    return this.data === null ? null : migrate(structuredClone(this.data));
  }
  async save(state: SaveState, opts?: { notify?: boolean }): Promise<void> {
    this.data = structuredClone(state);
    this.saveCount++;
    if (opts?.notify !== false) this.listeners.forEach((l) => l());
  }
  async clear(): Promise<void> {
    this.data = null;
    this.listeners.forEach((l) => l());
  }
  exportFile(state: SaveState): Blob {
    return exportFileFrom(state);
  }
  async importFile(file: Blob): Promise<SaveState> {
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
