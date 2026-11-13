import type { Action, GameEvent } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { cuesFor } from "./events";

const calm = { catchUp: false };
const names = (action: Action, events: GameEvent[], opts = calm) => cuesFor(action, events, opts).map((c) => c.name);

describe("action -> son", () => {
  it("chaque action acceptée a son son", () => {
    expect(names({ type: "feed", food: "meal" }, [])).toEqual(["meal"]);
    expect(names({ type: "feed", food: "snack" }, [])).toEqual(["snack"]);
    expect(names({ type: "clean" }, [])).toEqual(["clean"]);
    expect(names({ type: "heal" }, [])).toEqual(["heal"]);
    expect(names({ type: "play" }, [])).toEqual(["play"]);
    expect(names({ type: "pet" }, [])).toEqual(["pet"]);
    expect(names({ type: "sleep" }, [{ type: "fellAsleep" }])).toEqual(["sleep"]);
    expect(names({ type: "wake" }, [{ type: "wokeUp" }])).toEqual(["wake"]);
  });

  it("un refus est un murmure, sauf la caresse (silencieuse)", () => {
    const refused: GameEvent[] = [{ type: "actionRefused", action: "feed", reason: "full" }];
    expect(names({ type: "feed", food: "meal" }, refused)).toEqual(["refuse"]);
    expect(cuesFor({ type: "pet" }, refused, { catchUp: false, silentRefusal: true })).toEqual([]);
  });

  it("un stade franchi par une action vient après le son de l'action, sans le recouvrir", () => {
    const cues = cuesFor({ type: "feed", food: "meal" }, [{ type: "stageChanged", from: "baby", to: "child" }], calm);
    expect(cues.map((c) => c.name)).toEqual(["meal", "stage"]);
    expect(cues[1]?.delay).toBeGreaterThan(0.5);
  });

  it("l'éclosion, l'Envol et la renaissance ont leurs sons", () => {
    expect(names({ type: "tick" }, [{ type: "stageChanged", from: "egg", to: "baby" }])).toEqual(["hatch"]);
    expect(names({ type: "tick" }, [{ type: "flewAway" }])).toEqual(["flight"]);
    expect(names({ type: "rebirth", id: "a", name: "L", seed: 1 }, [{ type: "reborn" }])).toEqual(["rebirth"]);
  });
});

describe("tick", () => {
  it("un tick ordinaire sans événement ne dit rien", () => {
    expect(names({ type: "tick" }, [])).toEqual([]);
  });

  it("besoin et affaiblissement : sons discrets", () => {
    expect(names({ type: "tick" }, [{ type: "needAppeared", need: "satiety" }])).toEqual(["need"]);
    expect(names({ type: "tick" }, [{ type: "weakened" }])).toEqual(["weak"]);
  });

  it("au rattrapage : au plus un son résumé, le plus important, sans coucher ni réveil rejoués", () => {
    const many: GameEvent[] = [
      { type: "needAppeared", need: "satiety" },
      { type: "fellAsleep" },
      { type: "wokeUp" },
      { type: "becameSick" },
      { type: "weakened" },
      { type: "flewAway" },
    ];
    expect(names({ type: "tick" }, many, { catchUp: true })).toEqual(["flight"]);
    expect(names({ type: "tick" }, [{ type: "fellAsleep" }, { type: "wokeUp" }], { catchUp: true })).toEqual([]);
    expect(names({ type: "tick" }, [{ type: "weakened" }, { type: "becameSick" }], { catchUp: true })).toHaveLength(1);
  });
});
