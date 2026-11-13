// Sauvegarde dans IndexedDB (D2), lisible aussi par le futur service worker (D5).
// Les autres onglets sont prévenus par un BroadcastChannel (dernier écrit gagne).
import { migrate, MigrationError } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { MemorySaveStore } from "./memoryStore";
import { assertImportSize, compareStored, exportFileFrom, parseSave, refusalFor, serializeRaw } from "./saveStore";
import type { SaveOptions, SaveOutcome, SaveStore } from "./saveStore";

const DB_NAME = "tamagoshi";
const STORE = "kv";
const KEY = "save";
const CHANNEL = "tamagoshi-save";
const LOCK = "tamagoshi-save-lock";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("ouverture d'IndexedDB impossible"));
    req.onblocked = () => reject(new Error("ouverture d'IndexedDB bloquée par un autre onglet"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("erreur IndexedDB"));
  });
}

/** Résout quand la transaction est validée (et non quand la requête répond) ; rejette si elle échoue ou est annulée. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("transaction IndexedDB en échec"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction IndexedDB annulée"));
  });
}

/** Sérialise les écritures entre onglets (Web Locks) ; sans l'API, la transaction IndexedDB reste atomique. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") return fn();
  return locks.request(LOCK, fn);
}

export class IndexedDbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private channel: BroadcastChannel | null = null;

  /** Connexion vivante, rouverte au besoin : fermée par le navigateur, par une mise à jour de version, ou après une erreur. */
  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb().then(
      (db) => {
        const drop = (): void => {
          if (this.dbPromise !== null) this.dbPromise = null;
        };
        db.onclose = drop;
        db.onversionchange = () => {
          db.close();
          drop();
        };
        return db;
      },
      (e: unknown) => {
        this.dbPromise = null;
        throw e;
      },
    );
    return this.dbPromise;
  }

  /** Exécute `fn` ; en cas d'échec (connexion morte, transaction annulée), rouvre la base et réessaie une fois. */
  private async run<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.db());
    } catch (e) {
      if (e instanceof MigrationError) throw e;
      this.dbPromise = null;
      return await fn(await this.db());
    }
  }

  private getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    this.channel ??= new BroadcastChannel(CHANNEL);
    return this.channel;
  }

  async load(): Promise<SaveState | null> {
    const raw = await this.run((db) => request<unknown>(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)));
    return raw === undefined ? null : migrate(raw);
  }

  async readRaw(): Promise<string | null> {
    const raw = await this.run((db) => request<unknown>(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)));
    return raw === undefined ? null : serializeRaw(raw);
  }

  async save(state: SaveState, opts?: SaveOptions): Promise<SaveOutcome> {
    const outcome = await withLock(() =>
      this.run((db) => {
        // Lecture et écriture dans la même transaction : personne ne peut s'intercaler (D2, « relire avant d'écrire »).
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const finished = done(tx);
        return new Promise<SaveOutcome>((resolve, reject) => {
          const get = store.get(KEY);
          get.onerror = () => reject(get.error ?? new Error("lecture IndexedDB impossible"));
          get.onsuccess = () => {
            const stored: unknown = get.result;
            if (!opts?.force) {
              const verdict = compareStored(stored, state);
              const refusal = refusalFor(verdict);
              if (refusal) {
                tx.abort();
                reject(refusal);
                return;
              }
              if (verdict === "newer") {
                try {
                  resolve({ status: "newer", state: migrate(stored) });
                } catch (e) {
                  reject(e);
                }
                return;
              }
            }
            store.put(state, KEY);
            finished.then(() => resolve({ status: "saved" }), reject);
          };
          finished.catch(reject);
        });
      }),
    );
    if (outcome.status === "saved" && opts?.notify !== false) this.getChannel()?.postMessage({ type: "saved", savedAt: state.savedAt });
    return outcome;
  }

  async clear(): Promise<void> {
    await withLock(() =>
      this.run((db) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(KEY);
        return done(tx);
      }),
    );
    this.getChannel()?.postMessage({ type: "cleared" });
  }

  exportFile(state: SaveState): Blob {
    return exportFileFrom(state);
  }

  async importFile(file: Blob): Promise<SaveState> {
    assertImportSize(file);
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
