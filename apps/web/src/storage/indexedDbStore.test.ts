// Magasin IndexedDB : relire avant d'écrire (D2), verrou entre onglets, réouverture après une connexion morte,
// taille maximale d'import. IndexedDB est simulé en mémoire (pas de dépendance), les erreurs sont injectables.
import { createSave, defaultBalance, MigrationError } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDbSaveStore } from "./indexedDbStore";
import { MAX_IMPORT_BYTES } from "./saveStore";

const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

function makeSave(savedAtOffset = 0, name = "Lumi"): SaveState {
  const s = createSave({ id: "id-1", name, seed: 7 }, { nowMs: T0, utcOffsetMin: 0 }, defaultBalance);
  return { ...s, savedAt: T0 + savedAtOffset, pet: { ...s.pet, lastUpdatedAt: T0 + savedAtOffset } };
}

/** Faux IndexedDB : une base partagée entre toutes les connexions, transactions validées après les requêtes. */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const dbs: FakeDb[] = [];
  interface FakeDb {
    closed: boolean;
    onclose: (() => void) | null;
    onversionchange: (() => void) | null;
    failNextTransaction: boolean;
    close(): void;
    createObjectStore(): void;
    transaction(): unknown;
  }
  function openDb(): FakeDb {
    const db: FakeDb = {
      closed: false,
      onclose: null,
      onversionchange: null,
      failNextTransaction: false,
      close() {
        db.closed = true;
      },
      createObjectStore() {},
      transaction() {
        if (db.closed || db.failNextTransaction) {
          db.failNextTransaction = false;
          throw new DOMException("la connexion est fermée", "InvalidStateError");
        }
        const tx = { oncomplete: null as null | (() => void), onerror: null, onabort: null as null | (() => void), error: null, aborted: false, active: 0, abort: () => {} };
        const finishSoon = (): void => {
          setTimeout(() => {
            if (tx.active === 0 && !tx.aborted) tx.oncomplete?.();
          }, 0);
        };
        tx.abort = () => {
          tx.aborted = true;
          setTimeout(() => tx.onabort?.(), 0);
        };
        const request = (run: () => unknown) => {
          const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined as unknown, error: null };
          tx.active++;
          setTimeout(() => {
            if (!tx.aborted) {
              req.result = run();
              req.onsuccess?.();
            }
            tx.active--;
            finishSoon();
          }, 0);
          return req;
        };
        return Object.assign(tx, {
          objectStore: () => ({
            get: (key: string) => request(() => data.get(key)),
            put: (value: unknown, key: string) => request(() => void data.set(key, structuredClone(value))),
            delete: (key: string) => request(() => void data.delete(key)),
          }),
        });
      },
    };
    dbs.push(db);
    return db;
  }
  const indexedDB = {
    open: () => {
      const req = { onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null as null | (() => void), onblocked: null, result: null as unknown, error: null };
      setTimeout(() => {
        req.result = openDb();
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return { data, dbs, indexedDB };
}

let idb: ReturnType<typeof fakeIdb>;

beforeEach(() => {
  idb = fakeIdb();
  vi.stubGlobal("indexedDB", idb.indexedDB);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("IndexedDbSaveStore : relire avant d'écrire", () => {
  it("enregistre puis recharge", async () => {
    const store = new IndexedDbSaveStore();
    expect(await store.save(makeSave())).toEqual({ status: "saved" });
    expect((await store.load())?.pet.name).toBe("Lumi");
  });

  it("n'écrase pas une version stockée plus récente : elle est rendue pour être rechargée", async () => {
    const a = new IndexedDbSaveStore();
    const b = new IndexedDbSaveStore();
    await a.save(makeSave(0));
    await b.save(makeSave(5_000, "Soin fait dans l'autre onglet"));
    const outcome = await a.save(makeSave(1_000)); // l'onglet A, en retard, veut écrire
    expect(outcome.status).toBe("newer");
    if (outcome.status === "newer") expect(outcome.state.pet.name).toBe("Soin fait dans l'autre onglet");
    expect((await a.load())?.pet.name).toBe("Soin fait dans l'autre onglet");
  });

  it("écrit quand l'état est plus récent ou égal, et sur demande explicite (force) même si le stockage l'est plus", async () => {
    const store = new IndexedDbSaveStore();
    await store.save(makeSave(5_000, "Récent"));
    expect((await store.save(makeSave(5_000, "Egal"))).status).toBe("saved");
    expect((await store.save(makeSave(9_000, "Plus récent"))).status).toBe("saved");
    expect((await store.save(makeSave(1_000, "Importé"), { force: true })).status).toBe("saved");
    expect((await store.load())?.pet.name).toBe("Importé");
  });

  it("ne remplace jamais une sauvegarde d'une version plus récente du jeu, ni un contenu illisible", async () => {
    const store = new IndexedDbSaveStore();
    idb.data.set("save", { version: 999, savedAt: T0 + 99_000, pet: { lastUpdatedAt: T0 + 99_000 } });
    await expect(store.save(makeSave(100_000))).rejects.toMatchObject({ code: "unsupportedVersion" });
    expect(idb.data.get("save")).toMatchObject({ version: 999 });

    idb.data.set("save", { n: "importe quoi" });
    await expect(store.save(makeSave(100_000))).rejects.toBeInstanceOf(MigrationError);
    expect(idb.data.get("save")).toEqual({ n: "importe quoi" });
  });

  it("sérialise les écritures avec les Web Locks quand ils existent, et s'en passe sinon", async () => {
    const requested: string[] = [];
    const locks = {
      request: async (name: string, fn: () => Promise<unknown>) => {
        requested.push(name);
        return fn();
      },
    };
    vi.stubGlobal("navigator", { locks });
    const store = new IndexedDbSaveStore();
    await store.save(makeSave());
    await store.clear();
    expect(requested).toEqual(["tamagoshi-save-lock", "tamagoshi-save-lock"]);

    vi.stubGlobal("navigator", {});
    await expect(new IndexedDbSaveStore().save(makeSave())).resolves.toEqual({ status: "saved" });
  });

  it("deux écritures simultanées passent l'une après l'autre : la plus récente reste", async () => {
    let tail: Promise<unknown> = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_n: string, fn: () => Promise<unknown>) => (tail = tail.then(fn, fn)) } });
    const a = new IndexedDbSaveStore();
    const b = new IndexedDbSaveStore();
    const [ra, rb] = await Promise.all([a.save(makeSave(2_000, "A")), b.save(makeSave(1_000, "B"))]);
    expect(ra.status).toBe("saved");
    expect(rb.status).toBe("newer");
    expect((await a.load())?.pet.name).toBe("A");
  });
});

describe("IndexedDbSaveStore : connexion morte", () => {
  it("rouvre la base après une fermeture par le navigateur (onclose)", async () => {
    const store = new IndexedDbSaveStore();
    await store.save(makeSave(0));
    expect(idb.dbs).toHaveLength(1);
    const first = idb.dbs[0];
    if (!first) throw new Error("connexion absente");
    first.closed = true;
    first.onclose?.();
    expect((await store.save(makeSave(1_000))).status).toBe("saved");
    expect(idb.dbs).toHaveLength(2);
  });

  it("ferme et rouvre la base quand une autre version la réclame (versionchange)", async () => {
    const store = new IndexedDbSaveStore();
    await store.save(makeSave(0));
    const first = idb.dbs[0];
    first?.onversionchange?.();
    expect(first?.closed).toBe(true);
    await store.save(makeSave(1_000));
    expect(idb.dbs).toHaveLength(2);
  });

  it("réessaie une fois, sur une nouvelle connexion, après l'échec d'une transaction", async () => {
    const store = new IndexedDbSaveStore();
    await store.save(makeSave(0));
    const first = idb.dbs[0];
    if (first) first.failNextTransaction = true;
    expect((await store.save(makeSave(1_000, "Après l'échec"))).status).toBe("saved");
    expect(idb.dbs).toHaveLength(2);
    expect((await store.load())?.pet.name).toBe("Après l'échec");
  });
});

describe("IndexedDbSaveStore : contenu brut et import", () => {
  it("readRaw rend le contenu stocké tel quel, même illisible", async () => {
    const store = new IndexedDbSaveStore();
    expect(await store.readRaw()).toBeNull();
    idb.data.set("save", { version: 99, mystere: [1, 2, 3] });
    expect(JSON.parse((await store.readRaw()) ?? "null")).toEqual({ version: 99, mystere: [1, 2, 3] });
    await expect(store.load()).rejects.toBeInstanceOf(MigrationError);
  });

  it("refuse un fichier de plus de 256 Ko avant de le lire", async () => {
    const store = new IndexedDbSaveStore();
    const big = new Blob(["x".repeat(MAX_IMPORT_BYTES + 1)]);
    const text = vi.spyOn(big, "text");
    await expect(store.importFile(big)).rejects.toThrow(/trop volumineux/);
    expect(text).not.toHaveBeenCalled();
  });

  it("accepte un fichier de sauvegarde normal", async () => {
    const store = new IndexedDbSaveStore();
    const file = new Blob([JSON.stringify(makeSave())]);
    expect((await store.importFile(file)).pet.name).toBe("Lumi");
  });
});
