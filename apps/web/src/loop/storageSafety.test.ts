// Ne jamais perdre une sauvegarde : lecture seule après une erreur de chargement, version plus récente
// jamais effacée, erreurs d'écriture visibles, onglets multiples, boucle ralentie page cachée.
import { InvalidIdentityError, LIMITS, createSave, defaultBalance } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { MemorySaveStore } from "../storage/memoryStore";
import { MAX_IMPORT_BYTES } from "../storage/saveStore";
import { storageBarText } from "../ui/StorageNotices";
import { VirtualClock } from "./clock";
import { GameLoop, MAX_NAME_LENGTH } from "./gameLoop";
import type { Timers } from "./gameLoop";

const START = Date.UTC(2026, 10, 13, 12, 0, 0);

function setup(store = new MemorySaveStore(), startMs = START) {
  let real = startMs;
  const clock = new VirtualClock(() => real);
  const intervals: { ms: number; fn: () => void; active: boolean }[] = [];
  const timers: Timers = {
    setInterval: (fn, ms) => intervals.push({ ms, fn, active: true }) - 1,
    clearInterval: (h) => {
      const t = intervals[h as number];
      if (t) t.active = false;
    },
  };
  let n = 0;
  const game = new GameLoop({
    clock,
    balance: defaultBalance,
    store,
    utcOffsetMin: () => 0,
    timers,
    newIdentity: () => ({ id: `id-${++n}`, seed: 5 + n }),
    saveEveryTicks: 2,
  });
  const fire = (): void => intervals.filter((t) => t.active).forEach((t) => t.fn());
  return { game, store, advance: (ms: number) => (real += ms), intervals, fire };
}

function validSave(name = "Lumi", at = START): SaveState {
  return createSave({ id: "pet-1", name, seed: 3 }, { nowMs: at, utcOffsetMin: 0 }, defaultBalance);
}

describe("sauvegarde illisible : lecture seule, rien n'est écrasé", () => {
  it("après une erreur de chargement, ni tick, ni flush, ni action n'écrivent", async () => {
    const store = new MemorySaveStore();
    const garbage = { version: 1, pet: "cassé" };
    store.setRaw(garbage);
    const { game, fire } = setup(store);
    await game.init();
    const snap = game.getSnapshot();
    expect(snap.loadErrorCode).toBe("invalid");
    expect(snap.readOnly).toBe(true);
    game.start();
    for (let i = 0; i < 6; i++) fire();
    await game.flush();
    game.create("Lumi"); // même une création voulue ne doit pas écraser le contenu stocké
    await game.flush();
    expect(store.saveCount).toBe(0);
    expect(JSON.parse((await store.readRaw()) ?? "null")).toEqual(garbage);
    game.stop();
  });

  it("exporte le contenu brut, tel quel", async () => {
    const store = new MemorySaveStore();
    store.setRaw({ version: 1, etrange: true });
    const { game } = setup(store);
    await game.init();
    expect(JSON.parse((await game.exportRaw()) ?? "null")).toEqual({ version: 1, etrange: true });
  });

  it("la réinitialisation est possible (après confirmation de l'écran) et rend la main à l'écriture", async () => {
    const store = new MemorySaveStore();
    store.setRaw({ version: 1, pet: "cassé" });
    const { game } = setup(store);
    await game.init();
    expect(await game.reset()).toBe(true);
    expect(game.getSnapshot().readOnly).toBe(false);
    expect(await store.readRaw()).toBeNull();
    game.create("Lumi");
    await game.flush();
    expect((await store.load())?.pet.name).toBe("Lumi");
  });

  it("une version plus récente que le jeu n'est jamais effacée", async () => {
    const store = new MemorySaveStore();
    const newer = { version: 999, pet: { name: "Futur" } };
    store.setRaw(newer);
    const { game } = setup(store);
    await game.init();
    expect(game.getSnapshot().loadErrorCode).toBe("unsupportedVersion");
    expect(await game.reset()).toBe(false);
    expect(JSON.parse((await store.readRaw()) ?? "null")).toEqual(newer);
    expect(game.getSnapshot().loadErrorCode).toBe("unsupportedVersion");
  });

  it("une erreur de stockage (hors sauvegarde) passe aussi en lecture seule, et on peut jouer sans enregistrer", async () => {
    const store = new MemorySaveStore();
    store.load = async () => {
      throw new Error("IndexedDB inaccessible");
    };
    const { game } = setup(store);
    await game.init();
    expect(game.getSnapshot().loadErrorCode).toBe("storage");
    game.continueWithoutSave();
    expect(game.getSnapshot().loadError).toBeNull();
    expect(game.getSnapshot().readOnly).toBe(true);
    game.create("Lumi");
    await game.flush();
    expect(store.saveCount).toBe(0);
  });

  it("une sauvegarde valide écrite par un autre onglet sort de la lecture seule", async () => {
    const store = new MemorySaveStore();
    store.setRaw({ version: 1, pet: "cassé" });
    const { game } = setup(store);
    await game.init();
    game.start();
    await store.save(validSave(), { force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(game.getSnapshot().readOnly).toBe(false);
    expect(game.getSnapshot().state?.pet.name).toBe("Lumi");
    game.stop();
  });
});

describe("erreurs d'écriture visibles", () => {
  it("expose saveError, le message doux du bandeau, puis l'efface quand l'écriture réussit", async () => {
    const store = new MemorySaveStore();
    const { game } = setup(store);
    await game.init();
    game.create("Lumi");
    await game.flush();
    store.failWrites = true;
    await game.flush();
    const failing = game.getSnapshot();
    expect(failing.saveError).not.toBeNull();
    expect(storageBarText(failing)).toBe("La clairière n'arrive pas à garder ta partie : exporte-la pour ne rien perdre.");
    expect(game.exportBlob()).not.toBeNull(); // le bouton d'export du bandeau a de quoi exporter
    store.failWrites = false;
    await game.flush();
    expect(game.getSnapshot().saveError).toBeNull();
    expect(storageBarText(game.getSnapshot())).toBeNull();
  });
});

describe("plusieurs onglets : relire avant d'écrire", () => {
  it("un onglet en retard recharge la version plus récente au lieu de l'écraser", async () => {
    const store = new MemorySaveStore();
    const a = setup(store);
    await a.game.init();
    a.game.create("Lumi");
    await a.game.flush();

    const b = setup(store, START + 60_000);
    await b.game.init(); // B rattrape une minute
    b.game.dispatch({ type: "feed", food: "meal" });
    await b.game.flush();
    const careSavedAt = (await store.load())?.savedAt ?? 0;

    a.advance(61_000); // les deux onglets partagent la même horloge
    // L'onglet A n'a rien vu (pas de diffusion dans ce test) : son écriture périodique ne doit pas écraser le soin de B.
    await a.game.flush();
    expect((await store.load())?.savedAt).toBe(careSavedAt);
    expect(a.game.getSnapshot().state?.savedAt).toBeGreaterThanOrEqual(careSavedAt);
  });

  it("un réglage compte comme une écriture récente", async () => {
    const store = new MemorySaveStore();
    const a = setup(store);
    await a.game.init();
    a.game.create("Lumi");
    await a.game.flush();
    a.advance(5_000);
    const before = a.game.getSnapshot().state?.savedAt ?? 0;
    a.game.updateSettings({ sound: true });
    expect(a.game.getSnapshot().state?.savedAt).toBeGreaterThan(before);
  });
});

describe("page cachée", () => {
  it("la boucle passe à un rythme réduit et revient au rythme normal", async () => {
    const { game, intervals } = setup();
    await game.init();
    game.create("Lumi");
    game.start();
    expect(intervals.filter((t) => t.active).map((t) => t.ms)).toEqual([1000]);
    game.setHidden(true);
    expect(intervals.filter((t) => t.active).map((t) => t.ms)).toEqual([15_000]);
    game.setHidden(false);
    expect(intervals.filter((t) => t.active).map((t) => t.ms)).toEqual([1000]);
    game.stop();
  });
});

describe("limites", () => {
  it("une InvalidIdentityError des règles devient un message de formulaire, sans planter", async () => {
    expect(() => createSave({ id: "x", name: "y".repeat(LIMITS.nameMaxLength + 1), seed: 1 }, { nowMs: START, utcOffsetMin: 0 }, defaultBalance)).toThrow(InvalidIdentityError);
    const store = new MemorySaveStore();
    const game = new GameLoop({
      clock: new VirtualClock(() => START),
      balance: defaultBalance,
      store,
      utcOffsetMin: () => 0,
      newIdentity: () => ({ id: "i".repeat(200), seed: 1 }), // identifiant trop long : refusé par les règles
    });
    await game.init();
    expect(game.create("Lumi")).toEqual({ ok: false, reason: "tooLong" });
    expect(game.getSnapshot().state).toBeNull();
  });

  it("le nom est limité à 40 caractères (LIMITS des règles)", async () => {
    expect(MAX_NAME_LENGTH).toBe(LIMITS.nameMaxLength);
    expect(MAX_NAME_LENGTH).toBe(40);
    const { game } = setup();
    await game.init();
    expect(game.create("é".repeat(41))).toEqual({ ok: false, reason: "tooLong" });
    expect(game.create("é".repeat(40))).toEqual({ ok: true });
  });

  it("l'import refuse un fichier de plus de 256 Ko", async () => {
    expect(MAX_IMPORT_BYTES).toBe(256 * 1024);
    const { game } = setup();
    await game.init();
    await expect(game.parseImport(new Blob(["x".repeat(MAX_IMPORT_BYTES + 1)]))).rejects.toThrow(/trop volumineux/);
  });
});
