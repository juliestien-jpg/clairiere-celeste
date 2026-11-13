import { defaultBalance } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { MemorySaveStore } from "../storage/memoryStore";
import { VirtualClock } from "./clock";
import { GameLoop } from "./gameLoop";

const START = Date.UTC(2026, 10, 13, 12, 0, 0);

async function setup() {
  const store = new MemorySaveStore();
  const clock = new VirtualClock(() => START);
  const game = new GameLoop({ clock, balance: defaultBalance, store, utcOffsetMin: () => 0, newIdentity: () => ({ id: "x", seed: 3 }) });
  await game.init();
  return { game, store };
}

describe("réglages dans la sauvegarde", () => {
  it("modifient settings, sont enregistrés et survivent au temps qui passe", async () => {
    const { game, store } = await setup();
    game.create("Lumi");
    const rev = game.getSnapshot().revision;
    game.updateSettings({ reducedMotion: "on", sound: false, notifications: true });
    expect(game.getSnapshot().state?.settings).toEqual({ reducedMotion: "on", sound: false, notifications: true });
    expect(game.getSnapshot().revision).toBeGreaterThan(rev);
    await game.flush();
    expect((await store.load())?.settings).toEqual({ reducedMotion: "on", sound: false, notifications: true });
    game.dispatch({ type: "tick" });
    game.jump(3_600_000);
    expect(game.getSnapshot().state?.settings.reducedMotion).toBe("on");
  });

  it("sans animal, ne fait rien", async () => {
    const { game } = await setup();
    expect(() => game.updateSettings({ sound: false })).not.toThrow();
    expect(game.getSnapshot().state).toBeNull();
  });

  it("l'import se lit d'abord, et ne remplace l'animal qu'une fois confirmé", async () => {
    const a = await setup();
    a.game.create("Lumi");
    const file = a.game.exportBlob();
    expect(file).not.toBeNull();

    const b = await setup();
    b.game.create("Nuage");
    const parsed = await b.game.parseImport(file as Blob);
    expect(parsed.pet.name).toBe("Lumi");
    expect(b.game.getSnapshot().state?.pet.name).toBe("Nuage"); // rien n'a changé avant la confirmation
    await b.game.applyImport(parsed);
    expect(b.game.getSnapshot().state?.pet.name).toBe("Lumi");

    await expect(b.game.parseImport(new Blob(["pas une sauvegarde"]))).rejects.toThrow();
    expect(b.game.getSnapshot().state?.pet.name).toBe("Lumi");
  });
});
