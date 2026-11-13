// QA : actions (refus, temps de recharge, sommeil), Envol et renaissance, cohérence des événements.
import { describe, expect, it } from "vitest";
import { migrate, reduce } from "../src/index";
import type { Action, GameEvent, SaveState } from "../src/index";
import { at, B, clone, deepFreeze, fresh, gaugesOk, H, ID, MIN, NEVER, prng, T0, WORST } from "./qa-helpers";

const tick: Action = { type: "tick" };
const refused = (ev: GameEvent[]): GameEvent[] => ev.filter((e) => e.type === "actionRefused");

describe("QA actions : refus avec la bonne raison, état inchangé, jamais d'exception", () => {
  const cases: { name: string; patch: object; action: Action; reason: string }[] = [
    { name: "repas quand rassasié (>90)", patch: { pet: { gauges: { satiety: 95 } } }, action: { type: "feed", food: "meal" }, reason: "notHungry" },
    { name: "en-cas quand rassasié", patch: { pet: { gauges: { satiety: 91 } } }, action: { type: "feed", food: "snack" }, reason: "notHungry" },
    { name: "jouer à énergie 15 (inclusif)", patch: { pet: { gauges: { energy: 15 } } }, action: { type: "play" }, reason: "tooTired" },
    { name: "nettoyer un animal propre", patch: { pet: { gauges: { hygiene: 100 } } }, action: { type: "clean" }, reason: "alreadyClean" },
    { name: "soigner un animal sain", patch: {}, action: { type: "heal" }, reason: "nothingToHeal" },
    { name: "coucher un animal reposé (>85)", patch: { pet: { gauges: { energy: 90 } } }, action: { type: "sleep" }, reason: "notTired" },
    { name: "réveiller un animal éveillé", patch: {}, action: { type: "wake" }, reason: "notAsleep" },
    { name: "réveiller un animal épuisé (énergie<=5)", patch: { pet: { gauges: { energy: 5 }, status: { asleep: true, asleepSince: T0 } } }, action: { type: "wake" }, reason: "exhausted" },
    { name: "renaître alors que vivant", patch: {}, action: { type: "rebirth", id: "n", name: "Nova", seed: 1 }, reason: "notFlown" },
  ];
  for (const c of cases) {
    it(`${c.name} -> actionRefused(${c.reason}), jauges inchangées`, () => {
      const s = fresh(NEVER, c.patch);
      const noop = reduce(s, tick, at(0), B).state;
      const r = reduce(s, c.action, at(0), B);
      expect(r.events).toEqual([{ type: "actionRefused", action: c.action.type, reason: c.reason }]);
      expect(r.state).toEqual(noop);
    });
  }

  it("énergie 15,000001 : jouer est accepté ; 15 : refusé (frontière exacte)", () => {
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { energy: 15.000001 } } }), { type: "play" }, at(0), B).events)).toEqual([]);
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { energy: 15 } } }), { type: "play" }, at(0), B).events)).toHaveLength(1);
  });
  it("satiété 90 : repas accepté (inclusif) ; 90,0001 : refusé", () => {
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { satiety: 90 } } }), { type: "feed", food: "meal" }, at(0), B).events)).toEqual([]);
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { satiety: 90.0001 } } }), { type: "feed", food: "meal" }, at(0), B).events)).toHaveLength(1);
  });
  it("coucher à énergie 85 : accepté ; 85,5 : refusé", () => {
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { energy: 85 } } }), { type: "sleep" }, at(0), B).events)).toEqual([]);
    expect(refused(reduce(fresh(NEVER, { pet: { gauges: { energy: 85.5 } } }), { type: "sleep" }, at(0), B).events)).toHaveLength(1);
  });

  it("actions absurdes (type inconnu, repas sans nourriture, null) : jamais d'exception", () => {
    const s = fresh();
    for (const bad of [{ type: "explode" }, { type: "feed" }, { type: "feed", food: "pizza" }, {}, { type: "rebirth" }] as unknown as Action[]) {
      expect(() => reduce(s, bad, at(H), B)).not.toThrow();
    }
  });
  it("DÉFAUT action de type inconnu : doit être refusée avec une raison textuelle, pas avec `reason` undefined", () => {
    const r = reduce(fresh(), { type: "explode" } as unknown as Action, at(H), B);
    const ev = refused(r.events)[0];
    expect(ev && "reason" in ev ? typeof ev.reason : "aucun refus").toBe("string");
  });
  it("DÉFAUT repas avec `food` invalide : ne doit pas être silencieusement traité comme un en-cas", () => {
    const r = reduce(fresh(), { type: "feed", food: "pizza" } as unknown as Action, at(H), B);
    expect(refused(r.events)).toHaveLength(1);
  });
  it("DÉFAUT rebirth sans id ni nom (champs absents) sur un animal envolé : doit être refusé, pas lever une TypeError", () => {
    const flown = fresh(NEVER, { pet: { life: "flown", flownAt: T0 } });
    expect(() => reduce(flown, { type: "rebirth" } as unknown as Action, at(H), B)).not.toThrow();
  });
});

describe("QA temps de recharge", () => {
  const meal: Action = { type: "feed", food: "meal" };
  it("repas : second repas refusé (cooldown) tant que 5 400 s ne sont pas écoulées, accepté à l'instant exact", () => {
    const s0 = fresh(NEVER, { pet: { gauges: { satiety: 40, happiness: 10 } } });
    const s1 = reduce(s0, meal, at(0), B).state;
    expect(s1.pet.cooldowns["feed.meal"]).toBe(T0 + 5400000);
    // Satiété repassée sous 90 par patch pour isoler le cooldown de « notHungry ».
    const hungryAgain = (s: SaveState): SaveState => ({ ...s, pet: { ...s.pet, gauges: { ...s.pet.gauges, satiety: 30 } } });
    const early = reduce(hungryAgain(s1), meal, at(5400000 - 1), B);
    expect(early.events).toContainEqual({ type: "actionRefused", action: "feed", reason: "cooldown" });
    const exact = reduce(hungryAgain(s1), meal, at(5400000), B);
    expect(refused(exact.events)).toEqual([]);
  });
  it("le cooldown du repas n'empêche pas l'en-cas, ni l'inverse (compteurs séparés)", () => {
    const s0 = fresh(NEVER, { pet: { gauges: { satiety: 20 } } });
    const s1 = reduce(s0, meal, at(0), B).state;
    const s2 = reduce({ ...s1, pet: { ...s1.pet, gauges: { ...s1.pet.gauges, satiety: 20 } } }, { type: "feed", food: "snack" }, at(1000), B);
    expect(refused(s2.events)).toEqual([]);
  });
  it("caresse : 300 s ; soin : 900 s ; raison cooldown, et le bonheur n'augmente pas pendant le refus", () => {
    const s0 = fresh(NEVER, { pet: { gauges: { happiness: 50, health: 50 }, status: { sick: true, sickSince: T0 } } });
    const p1 = reduce(s0, { type: "pet" }, at(0), B).state;
    const p2 = reduce(p1, { type: "pet" }, at(299 * 1000), B);
    expect(p2.events).toContainEqual({ type: "actionRefused", action: "pet", reason: "cooldown" });
    expect(p2.state.pet.gauges.happiness).toBeLessThan(p1.pet.gauges.happiness); // décroissance seule
    expect(refused(reduce(p1, { type: "pet" }, at(300 * 1000), B).events)).toEqual([]);
    const h1 = reduce(s0, { type: "heal" }, at(0), B).state;
    expect(h1.pet.status.sick).toBe(false);
    const sickAgain = { ...h1, pet: { ...h1.pet, status: { ...h1.pet.status, sick: true, sickSince: T0 } } };
    expect(reduce(sickAgain, { type: "heal" }, at(899 * 1000), B).events).toContainEqual({ type: "actionRefused", action: "heal", reason: "cooldown" });
    expect(refused(reduce(sickAgain, { type: "heal" }, at(900 * 1000), B).events)).toEqual([]);
  });
  it("un cooldown dans le futur lointain (état migré, horloge reculée) ne bloque pas plus que prévu et ne plante pas", () => {
    const s = fresh(NEVER, { pet: { cooldowns: { "feed.meal": T0 + 1e15 } } });
    const r = reduce(s, meal, at(H), B);
    expect(r.events).toContainEqual({ type: "actionRefused", action: "feed", reason: "cooldown" });
  });
  it("horloge qui recule : le cooldown ne se réinitialise pas et ne s'allonge pas", () => {
    const s0 = fresh(NEVER, { pet: { gauges: { satiety: 30 } } });
    const s1 = reduce(s0, { type: "pet" }, at(10 * MIN), B).state;
    const cd = s1.pet.cooldowns["pet"];
    const s2 = reduce(s1, { type: "pet" }, at(5 * MIN), B); // recul : refusé, cooldown inchangé
    expect(s2.state.pet.cooldowns["pet"]).toBe(cd);
  });
});

describe("QA sommeil : actions pendant le sommeil", () => {
  const asleep = (): SaveState => fresh(NEVER, { pet: { gauges: { energy: 20, satiety: 30, hygiene: 30 }, status: { asleep: true, asleepSince: T0 } } });
  const blocked: Action[] = [{ type: "feed", food: "meal" }, { type: "feed", food: "snack" }, { type: "play" }, { type: "clean" }, { type: "heal" }, { type: "sleep" }, { type: "pet" }];
  for (const a of blocked) {
    it(`${a.type}${a.type === "feed" ? ` ${a.food}` : ""} pendant le sommeil -> refusé (asleep), l'animal dort toujours, aucun cooldown posé`, () => {
      const r = reduce(asleep(), a, at(MIN), B);
      expect(r.events).toEqual([{ type: "actionRefused", action: a.type, reason: "asleep" }]);
      expect(r.state.pet.status.asleep).toBe(true);
      expect(r.state.pet.cooldowns).toEqual(asleep().pet.cooldowns);
    });
  }
  it("wake accepté pendant le sommeil si énergie > 5 ; tick autorisé", () => {
    const w = reduce(asleep(), { type: "wake" }, at(MIN), B);
    expect(w.events).toEqual([{ type: "wokeUp" }]);
    expect(reduce(asleep(), tick, at(H), B).events.some((e) => e.type === "actionRefused")).toBe(false);
  });
  it("sommeil : l'énergie remonte de 6,5/h, la satiété ne baisse que de 1,5/h, aucune salissure", () => {
    const r = reduce(asleep(), tick, at(2 * H), B).state;
    expect(r.pet.gauges.energy).toBeCloseTo(20 + 13, 3);
    expect(r.pet.gauges.satiety).toBeCloseTo(30 - 3, 3);
    expect(r.pet.status.messes).toBe(0);
    expect(r.pet.status.messProgressSeconds).toBe(0);
  });
  it("un animal qui dort tout seul (énergie 5) : toute action de soin est refusée avec 'asleep', même `wake` avec 'exhausted'", () => {
    let s = fresh(NEVER, { pet: { gauges: { energy: 5.01 } } });
    s = reduce(s, tick, at(MIN), B).state;
    expect(s.pet.status.asleep).toBe(true);
    expect(reduce(s, { type: "feed", food: "meal" }, at(2 * MIN), B).events).toContainEqual({ type: "actionRefused", action: "feed", reason: "asleep" });
    // À l'instant même (pas de temps rattrapé) : énergie ~4,95 <= 5, réveil refusé.
    expect(reduce(s, { type: "wake" }, at(MIN), B).events).toContainEqual({ type: "actionRefused", action: "wake", reason: "exhausted" });
  });
  it("un animal malade ou affaibli endormi peut encore perdre de la santé : le sommeil ne protège pas des besoins critiques", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 2, energy: 20, health: 90 }, status: { asleep: true, asleepSince: T0 } } });
    expect(reduce(s, tick, at(3 * H), B).state.pet.gauges.health).toBeLessThan(90);
  });
});

describe("QA Envol", () => {
  const flownState = (patch: object = {}): SaveState => fresh(NEVER, { pet: { life: "flown", flownAt: T0 - H, gauges: { health: 0 } }, ...patch });
  const allButRebirth: Action[] = [
    tick,
    { type: "feed", food: "meal" },
    { type: "feed", food: "snack" },
    { type: "play" },
    { type: "clean" },
    { type: "heal" },
    { type: "sleep" },
    { type: "wake" },
    { type: "pet" },
  ];
  for (const a of allButRebirth) {
    for (const when of [0, 3 * H, 400 * H, -5 * H]) {
      it(`après l'Envol, ${a.type} (à ${when / H} h) est refusé (flown) et l'état ne change pas`, () => {
        const s = flownState();
        const r = reduce(s, a, at(when), B);
        expect(r.events).toEqual([{ type: "actionRefused", action: a.type, reason: "flown" }]);
        expect(r.state).toEqual(s);
      });
    }
  }

  it("l'Envol survient pendant le rattrapage : événements dans l'ordre, flownAt = fin de pas, plus aucun pas ensuite", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 }, status: { sick: true, sickSince: T0 } } });
    const r = reduce(s, tick, at(500 * H), B);
    expect(r.state.pet.life).toBe("flown");
    expect(r.events.filter((e) => e.type === "flewAway")).toHaveLength(1);
    const flownAt = r.state.pet.flownAt ?? -1;
    expect(flownAt).toBeGreaterThan(T0);
    expect(flownAt).toBeLessThan(T0 + 2 * H); // 1 point de santé à 1,6/h : < 40 min
    expect((flownAt - T0) % (60 * 1000)).toBe(0);
    expect(r.state.pet.lastUpdatedAt).toBe(flownAt); // l'horloge de l'animal s'arrête à l'Envol (grille fixe)
    expect(r.state.pet.gauges.health).toBe(0);
  });

  it("une action émise alors que l'animal s'envole pendant le rattrapage est refusée (flownDuringCatchUp), le temps déjà rattrapé reste", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 }, status: { sick: true, sickSince: T0 } } });
    const r = reduce(s, { type: "feed", food: "meal" }, at(10 * H), B);
    expect(r.events).toContainEqual({ type: "flewAway" });
    expect(r.events).toContainEqual({ type: "actionRefused", action: "feed", reason: "flownDuringCatchUp" });
    expect(r.state.pet.life).toBe("flown");
  });

  it("garde-fou : même avec soins réguliers toutes les 6 h pendant 30 jours, l'animal ne s'envole pas", () => {
    let s = fresh(NEVER);
    for (let i = 1; i <= 120; i++) {
      const t = at(i * 6 * H);
      s = reduce(s, tick, t, B).state;
      for (const a of [{ type: "feed", food: "meal" }, { type: "clean" }, { type: "play" }, { type: "heal" }] as Action[]) s = reduce(s, a, t, B).state;
      if (i % 4 === 0) s = reduce(s, { type: "sleep" }, t, B).state;
      expect(s.pet.life).toBe("alive");
    }
  });
});

describe("QA renaissance (rebirth)", () => {
  const flown = (): SaveState =>
    fresh(NEVER, {
      pet: { name: "Lumi", life: "flown", flownAt: T0 + 5 * H, stage: "child", bornAt: T0 - 30 * H, gauges: { health: 0 } },
      album: [{ id: "old-1", name: "Aïe", bornAt: 1, flownAt: 2, stage: "teen", kind: "kawaii" }],
      settings: { reducedMotion: "on", sound: false, notifications: true },
    });
  const rebirth: Action = { type: "rebirth", id: "11111111-2222-4333-8444-555555555555", name: "Nova", seed: 777, kind: "feerique" };

  it("conserve l'album (ajoute l'envolé) et les réglages ; nouvel animal oeuf neuf, vivant", () => {
    const r = reduce(flown(), rebirth, at(10 * H), B);
    expect(r.events).toEqual([{ type: "reborn" }]);
    const s = r.state;
    expect(s.album).toEqual([
      { id: "old-1", name: "Aïe", bornAt: 1, flownAt: 2, stage: "teen", kind: "kawaii" },
      { id: ID, name: "Lumi", bornAt: T0 - 30 * H, flownAt: T0 + 5 * H, stage: "child", kind: "kawaii" },
    ]);
    expect(s.settings).toEqual({ reducedMotion: "on", sound: false, notifications: true });
    expect(s.pet.id).toBe("11111111-2222-4333-8444-555555555555");
    expect(s.pet.name).toBe("Nova");
    expect(s.pet.life).toBe("alive");
    expect(s.pet.flownAt).toBeNull();
    expect(s.pet.stage).toBe("egg");
    expect(s.pet.bornAt).toBe(T0 + 10 * H);
    expect(s.pet.lastUpdatedAt).toBe(T0 + 10 * H);
    expect(s.pet.gauges).toEqual({ satiety: 80, happiness: 80, energy: 80, hygiene: 100, health: 100 });
    expect(s.pet.status).toEqual({ asleep: false, asleepSince: null, sick: false, sickSince: null, messes: 0, messProgressSeconds: 0, weakSince: null });
    expect(s.pet.cooldowns).toEqual({ "feed.meal": 0, "feed.snack": 0, heal: 0, pet: 0 });
    expect(s.pet.rng).toBe(777);
    expect(s.pet.kind).toBe("feerique");
    expect(s.version).toBe(2);
    expect(gaugesOk(s)).toBeNull();
    expect(() => migrate(clone(s))).not.toThrow();
  });

  it("double rebirth : le second est refusé (notFlown), rien ne change, l'album n'est pas dupliqué", () => {
    const first = reduce(flown(), rebirth, at(10 * H), B).state;
    const second = reduce(first, { ...rebirth, id: "other", name: "Autre" }, at(10 * H), B);
    expect(second.events).toEqual([{ type: "actionRefused", action: "rebirth", reason: "notFlown" }]);
    expect(second.state).toEqual(first);
    expect(second.state.album).toHaveLength(2);
  });

  it("rebirth sur un animal vivant : refusé, l'animal garde son nom, ses jauges et l'album", () => {
    const s = fresh(NEVER);
    const r = reduce(s, rebirth, at(0), B);
    expect(r.events).toEqual([{ type: "actionRefused", action: "rebirth", reason: "notFlown" }]);
    expect(r.state).toEqual(s);
  });

  it("identité invalide (id ou nom vide / espaces) : refusée (invalidIdentity), l'animal reste envolé et l'album intact", () => {
    for (const bad of [{ id: "", name: "N" }, { id: "x", name: "" }, { id: "  ", name: "N" }, { id: "x", name: "\t \n" }]) {
      const s = flown();
      const r = reduce(s, { type: "rebirth", seed: 1, ...bad }, at(H), B);
      expect(r.events).toEqual([{ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" }]);
      expect(r.state).toEqual(s);
    }
  });

  it("graines exotiques (négative, décimale, NaN, > 2^32) : rng reste un entier 32 bits non signé", () => {
    for (const seed of [-1, 1.9, Number.NaN, 2 ** 40 + 5, Number.POSITIVE_INFINITY]) {
      const r = reduce(flown(), { type: "rebirth", id: "n", name: "N", seed }, at(H), B).state;
      expect(Number.isInteger(r.pet.rng) && r.pet.rng >= 0 && r.pet.rng <= 4294967295).toBe(true);
    }
  });

  it("deux Envols et deux renaissances successifs : l'album garde les deux dans l'ordre", () => {
    let s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 2 } } });
    s = reduce(s, tick, at(20 * H), B).state;
    expect(s.pet.life).toBe("flown");
    s = reduce(s, { type: "rebirth", id: "b", name: "Deux", seed: 14056 }, at(21 * H), B).state;
    s = reduce(s, tick, at(21 * H + 1000 * H), B).state; // abandon total, jauges initiales
    expect(s.pet.life).toBe("flown");
    s = reduce(s, { type: "rebirth", id: "c", name: "Trois", seed: 5 }, at(1100 * H), B).state;
    expect(s.album.map((e) => e.name)).toEqual(["Lumi", "Deux"]);
    expect(s.album.map((e) => e.id)).toEqual([ID, "b"]);
    expect(s.pet.name).toBe("Trois");
  });

  it("rebirth avec une horloge reculée : nouvel animal né à lastUpdatedAt (pas dans le passé de l'ancien)", () => {
    const s = flown();
    const r = reduce(s, rebirth, at(-100 * H), B).state;
    expect(r.pet.bornAt).toBe(s.pet.lastUpdatedAt);
    expect(r.pet.lastUpdatedAt).toBeGreaterThanOrEqual(s.pet.lastUpdatedAt);
  });

  it("l'entrée est gelée : rebirth ne mute ni l'album ni l'animal reçus", () => {
    const s = deepFreeze(flown());
    expect(() => reduce(s, deepFreeze(clone(rebirth)), at(10 * H), B)).not.toThrow();
  });

  it("rebirth quand l'animal s'envole pendant le rattrapage du même appel : refusé (flownDuringCatchUp), le joueur doit voir l'Envol d'abord", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 }, status: { sick: true, sickSince: T0 } } });
    const r = reduce(s, rebirth, at(10 * H), B);
    const types = r.events.map((e) => e.type);
    expect(types).toContain("flewAway");
    expect(types).not.toContain("reborn");
    expect(r.events).toContainEqual({ type: "actionRefused", action: "rebirth", reason: "flownDuringCatchUp" });
    expect(r.state.pet.life).toBe("flown");
    expect(r.state.album).toHaveLength(0);
    // Au prochain appel, l'animal était déjà envolé au début : la renaissance est acceptée.
    const again = reduce(r.state, rebirth, at(10 * H + MIN), B);
    expect(again.events.map((e) => e.type)).toContain("reborn");
    expect(again.state.album).toHaveLength(1);
  });
});

describe("QA cohérence des événements de besoin sur de longues parties", () => {
  type Needs = { satiety: boolean; hygiene: boolean; happiness: boolean; energy: boolean; sick: boolean; weak: boolean };
  const needsOf = (s: SaveState): Needs => ({
    satiety: s.pet.gauges.satiety <= B.gauges.satiety.low,
    hygiene: s.pet.gauges.hygiene <= B.gauges.hygiene.low,
    happiness: s.pet.gauges.happiness <= B.gauges.happiness.low,
    energy: s.pet.gauges.energy <= B.gauges.energy.low,
    sick: s.pet.status.sick,
    weak: s.pet.status.weakSince !== null,
  });
  it("l'ensemble des besoins reconstitué à partir des événements = besoins réels, après chaque appel (3 graines)", () => {
    for (const seed of [WORST, NEVER, 4242]) {
      const rnd = prng(seed);
      let s = fresh(seed);
      let known = needsOf(s);
      let now = T0;
      for (let i = 0; i < 1500; i++) {
        now += Math.floor(rnd() * 5 * H);
        const pool: Action[] = [tick, tick, { type: "feed", food: "meal" }, { type: "feed", food: "snack" }, { type: "play" }, { type: "clean" }, { type: "heal" }, { type: "sleep" }, { type: "wake" }, { type: "pet" }];
        const a = pool[Math.floor(rnd() * pool.length)] ?? tick;
        const r = reduce(s, a, { nowMs: now, utcOffsetMin: 0 }, B);
        s = r.state;
        if (s.pet.life === "flown") {
          s = reduce(s, { type: "rebirth", id: `id${i}`, name: "N", seed: i }, { nowMs: now, utcOffsetMin: 0 }, B).state;
          known = needsOf(s);
          continue;
        }
        for (const e of r.events) {
          if (e.type === "needAppeared") {
            expect(known[e.need], `${seed}/${i} : ${e.need} déjà actif`).toBe(false);
            known[e.need] = true;
          } else if (e.type === "needResolved") {
            expect(known[e.need], `${seed}/${i} : ${e.need} pas actif`).toBe(true);
            known[e.need] = false;
          }
        }
        expect(known, `${seed}/${i}`).toEqual(needsOf(s));
      }
    }
  });
});
