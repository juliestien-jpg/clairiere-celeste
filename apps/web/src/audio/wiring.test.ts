// Branchement des sons sur la boucle de jeu : une action = un son ; un rattrapage de temps = au plus un son.
import { defaultBalance } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { VirtualClock } from "../loop/clock";
import { GameLoop } from "../loop/gameLoop";
import { MemorySaveStore } from "../storage/memoryStore";
import { cuesFor } from "./events";
import type { SoundCue } from "./events";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 13, 12, 0, 0);

function setup() {
  const clock = new VirtualClock(() => START);
  const played: SoundCue[][] = [];
  const game = new GameLoop({
    clock,
    balance: defaultBalance,
    store: new MemorySaveStore(),
    utcOffsetMin: () => 60,
    newIdentity: () => ({ id: "id", seed: 7 }),
    onDispatch: ({ action, events, catchUp, silentRefusal }) => {
      const cues = cuesFor(action, events, { catchUp, silentRefusal });
      if (cues.length > 0) played.push(cues);
    },
  });
  return { game, clock, played };
}

describe("sons branchés sur la boucle", () => {
  it("une action du joueur déclenche le son de l'action", async () => {
    const { game, played } = setup();
    await game.init();
    game.create("Lumi");
    game.dispatch({ type: "pet" });
    expect(played.at(-1)?.[0]?.name).toBe("pet");
    game.dispatch({ type: "pet" }); // recharge : refus annoncé
    expect(played.at(-1)?.[0]?.name).toBe("refuse");
    const n = played.length;
    game.dispatch({ type: "pet" }, { silentRefusal: true });
    expect(played.length).toBe(n); // refus de caresse : silence
  });

  it("un rattrapage de plusieurs jours ne joue qu'un seul son résumé", async () => {
    const { game, clock, played } = setup();
    await game.init();
    game.create("Lumi");
    clock.jump(3 * 24 * HOUR);
    game.tick();
    expect(played.length).toBeLessThanOrEqual(1);
    expect(played.flat().length).toBeLessThanOrEqual(1);
  });

  it("les ticks ordinaires, sans événement, restent silencieux", async () => {
    const { game, played } = setup();
    await game.init();
    game.create("Lumi");
    for (let i = 0; i < 20; i++) game.tick();
    expect(played).toEqual([]);
  });
});
