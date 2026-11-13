// Sauvegarde dans IndexedDB (D2), lisible aussi par le futur service worker (D5).
// Les autres onglets sont prévenus par un BroadcastChannel (dernier écrit gagne).
import { migrate } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { MemorySaveStore } from "./memoryStore";
import { exportFileFrom, parseSave } from "./saveStore";
import type { SaveStore } from "./saveStore";

const DB_NAME = "tamagoshi";
const STORE = "kv";
const KEY = "save";
const CHANNEL = "tamagoshi-save";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("ouverture d'IndexedDB impossible"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("erreur IndexedDB"));
  });
}

export class IndexedDbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private channel: BroadcastChannel | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  private getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    this.channel ??= new BroadcastChannel(CHANNEL);
    return this.channel;
  }

  async load(): Promise<SaveState | null> {
    const db = await this.db();
    const raw: unknown = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
    return raw === undefined ? null : migrate(raw);
  }

  async save(state: SaveState, opts?: { notify?: boolean }): Promise<void> {
    const db = await this.db();
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(state, KEY));
    if (opts?.notify !== false) this.getChannel()?.postMessage({ type: "saved", savedAt: state.savedAt });
  }

  async clear(): Promise<void> {
    const db = await this.db();
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY));
    this.getChannel()?.postMessage({ type: "cleared" });
  }

  exportFile(state: SaveState): Blob {
    return exportFileFrom(state);
  }

  async importFile(file: Blob): Promise<SaveState> {
    return parseSave(await file.text());
  }

  subscribe(listener: () => void): () => void {
    const ch = this.getChannel();
    if (!ch) return () => {};
    const handler = (): void => listener();
    ch.addEventListener("message", handler);
    return () => ch.removeEventListener("message", handler);
  }

  async requestPersistence(): Promise<boolean> {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
}

/** IndexedDB si disponible, sinon un repli en mémoire (la sauvegarde ne survivra pas au rechargement). */
export function createDefaultStore(): { store: SaveStore; persistent: boolean } {
  if (typeof indexedDB === "undefined") return { store: new MemorySaveStore(), persistent: false };
  return { store: new IndexedDbSaveStore(), persistent: true };
}
