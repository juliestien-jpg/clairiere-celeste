import { createSave, defaultBalance } from "@tamagoshi/rules";
import type { SaveState } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { MemorySaveStore } from "../storage/memoryStore";
import { VirtualClock } from "./clock";
import { GameLoop } from "./gameLoop";
import type { Timers } from "./gameLoop";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 13, 12, 0, 0);

function setup(store = new MemorySaveStore()) {
  let real = START;
  const clock = new VirtualClock(() => real);
  const handlers: (() => void)[] = [];
  const timers: Timers = {
    setInterval: (fn) => {
      handlers.push(fn);
      return handlers.length - 1;
    },
    clearInterval: (h) => {
      handlers[h as number] = () => {};
    },
  };
  let n = 0;
  const game = new GameLoop({
    clock,
    balance: defaultBalance,
    store,
    utcOffsetMin: () => 60,
    timers,
    newIdentity: () => ({ id: `id-${++n}`, seed: 42 + n }),
    saveEveryTicks: 3,
  });
  return { game, clock, store, advance: (ms: number) => (real += ms), fire: () => handlers.forEach((h) => h()), handlers };
}

describe("GameLoop", () => {
  it("démarre sans sauvegarde puis crée l'animal et l'enregistre", async () => {
    const { game, store } = setup();
    await game.init();
    expect(game.getSnapshot().ready).toBe(true);
    expect(game.getSnapshot().state).toBeNull();
    expect(game.create("  Lumi ")).toEqual({ ok: true });
    expect(game.getSnapshot().state?.pet.name).toBe("Lumi");
    await Promise.resolve();
    expect((await store.load())?.pet.id).toBe("id-1");
  });

  it("refuse les noms vides ou trop longs", async () => {
    const { game } = setup();
    await game.init();
    expect(game.create("   ")).toEqual({ ok: false, reason: "emptyName" });
    expect(game.create("x".repeat(41))).toEqual({ ok: false, reason: "tooLong" });
    expect(game.getSnapshot().state).toBeNull();
  });

  it("le tick fait passer le temps virtuel et baisse les jauges", async () => {
    const { game, clock } = setup();
    await game.init();
    game.create("Lumi");
    const before = game.getSnapshot().state?.pet.gauges.satiety ?? 0;
    clock.setSpeed(3600);
    // 1 s réelle à ×3600 = 1 h virtuelle
    game.jump(0);
    clock.jump(HOUR);
    game.tick();
    const after = game.getSnapshot().state?.pet.gauges.satiety ?? 0;
    expect(after).toBeLessThan(before);
    expect(game.getSnapshot().state?.pet.lastUpdatedAt).toBe(game.getSnapshot().time.nowMs);
  });

  it("passe toujours Time (nowMs, utcOffsetMin) aux règles", async () => {
    const { game } = setup();
    await game.init();
    expect(game.time()).toEqual({ nowMs: START, utcOffsetMin: 60 });
  });

  it("le timer appelle tick, et sauvegarde périodiquement sans prévenir les autres onglets", async () => {
    const { game, store, fire } = setup();
    await game.init();
    game.create("Lumi");
    game.start();
    game.start(); // idempotent : un seul timer
    await Promise.resolve();
    const base = store.saveCount;
    fire();
    fire();
    expect(store.saveCount).toBe(base);
    fire(); // 3e tick : sauvegarde périodique
    await Promise.resolve();
    expect(store.saveCount).toBe(base + 1);
    game.stop();
  });

  it("une action est appliquée, consignée et enregistrée ; une action refusée produit une notice", async () => {
    const { game, store } = setup();
    await game.init();
    game.create("Lumi");
    const ok = game.dispatch({ type: "pet" });
    expect(ok.some((e) => e.type === "actionRefused")).toBe(false);
    const refused = game.dispatch({ type: "pet" }); // délai de récupération
    expect(refused).toContainEqual({ type: "actionRefused", action: "pet", reason: "cooldown" });
    expect(game.getSnapshot().notice?.events[0]).toMatchObject({ type: "actionRefused", reason: "cooldown" });
    expect(game.getSnapshot().journal.length).toBeGreaterThan(0);
    await Promise.resolve();
    expect(store.saveCount).toBeGreaterThan(0);
  });

  it("un refus silencieux (caresse en recharge) reste au journal sans notice affichée", async () => {
    const { game } = setup();
    await game.init();
    game.create("Lumi");
    game.dispatch({ type: "pet" });
    const seqBefore = game.getSnapshot().notice?.seq ?? 0;
    const refused = game.dispatch({ type: "pet" }, { silentRefusal: true });
    expect(refused).toContainEqual({ type: "actionRefused", action: "pet", reason: "cooldown" });
    expect(game.getSnapshot().notice?.seq ?? 0).toBe(seqBefore);
    expect(game.getSnapshot().journal[0]?.event).toMatchObject({ type: "actionRefused", reason: "cooldown" });
  });

  it("rattrape le temps d'absence au chargement", async () => {
    const store = new MemorySaveStore();
    const first = setup(store);
    await first.game.init();
    first.game.create("Lumi");
    await Promise.resolve();
    const saved = (await store.load()) as SaveState;

    const second = setup(store);
    second.advance(0);
    second.clock.jump(5 * HOUR);
    await second.game.init();
    const s = second.game.getSnapshot().state;
    expect(s?.pet.lastUpdatedAt).toBe(START + 5 * HOUR);
    expect((s?.pet.gauges.satiety ?? 100) < saved.pet.gauges.satiety).toBe(true);
  });

  it("ignore l'actionRefused d'un tick après l'Envol et permet la renaissance", async () => {
    const { game, clock } = setup();
    await game.init();
    game.create("Lumi");
    let guard = 0;
    while (game.getSnapshot().state?.pet.life !== "flown" && guard++ < 30) {
      clock.jump(2 * 24 * HOUR);
      game.tick();
    }
    expect(game.getSnapshot().state?.pet.life).toBe("flown");
    expect(game.getSnapshot().journal.some((j) => j.event.type === "flewAway")).toBe(true);
    const n = game.getSnapshot().journal.length;
    game.tick();
    game.tick();
    expect(game.getSnapshot().journal.length).toBe(n);
    expect(game.getSnapshot().journal.some((j) => j.event.type === "actionRefused")).toBe(false);

    const events = game.rebirth("Étoile");
    expect(events).toContainEqual({ type: "reborn" });
    const s = game.getSnapshot().state;
    expect(s?.pet.life).toBe("alive");
    expect(s?.pet.name).toBe("Étoile");
    expect(s?.album).toHaveLength(1);
  });

  it("la renaissance tire l'espèce, ou la force quand on la demande (débogage)", async () => {
    for (const kind of ["kawaii", "feerique"] as const) {
      const { game, clock } = setup();
      await game.init();
      game.create("Lumi");
      let guard = 0;
      while (game.getSnapshot().state?.pet.life !== "flown" && guard++ < 30) {
        clock.jump(2 * 24 * HOUR);
        game.tick();
      }
      const events = game.rebirth("Forcé", kind);
      expect(events).toContainEqual({ type: "reborn" });
      const s = game.getSnapshot().state;
      expect(s?.pet.kind).toBe(kind);
      expect(game.getSnapshot().view?.kind).toBe(kind);
      expect(s?.album[0]?.kind).toBeDefined();
    }
  });

  it("sans espèce demandée, la renaissance laisse les règles tirer (kind valide)", async () => {
    const { game, clock } = setup();
    await game.init();
    game.create("Lumi");
    let guard = 0;
    while (game.getSnapshot().state?.pet.life !== "flown" && guard++ < 30) {
      clock.jump(2 * 24 * HOUR);
      game.tick();
    }
    game.rebirth("Tirée");
    expect(["kawaii", "feerique"]).toContain(game.getSnapshot().state?.pet.kind);
  });

  it("signale une sauvegarde illisible sans planter", async () => {
    const store = new MemorySaveStore();
    store.setRaw({ version: 99 });
    const { game } = setup(store);
    await game.init();
    expect(game.getSnapshot().loadError).toMatch(/version/);
    expect(game.getSnapshot().state).toBeNull();
  });

  it("exporte puis réimporte la sauvegarde, et la réinitialise", async () => {
    const { game } = setup();
    await game.init();
    game.create("Lumi");
    const blob = game.exportBlob();
    expect(blob).not.toBeNull();
    await game.reset();
    expect(game.getSnapshot().state).toBeNull();
    await game.importFile(blob as Blob);
    expect(game.getSnapshot().state?.pet.name).toBe("Lumi");
    await expect(game.importFile(new Blob(["pas du json"]))).rejects.toThrow();
    expect(game.getSnapshot().state?.pet.name).toBe("Lumi");
  });

  it("recharge l'état quand un autre onglet écrit", async () => {
    const store = new MemorySaveStore();
    const a = setup(store);
    await a.game.init();
    a.game.start();
    const other = createSave({ id: "x", name: "Autre", seed: 1 }, { nowMs: START, utcOffsetMin: 60 }, defaultBalance);
    await store.save(other); // notifie les abonnés
    await new Promise((r) => setTimeout(r, 0));
    expect(a.game.getSnapshot().state?.pet.name).toBe("Autre");
    a.game.stop();
  });
});
