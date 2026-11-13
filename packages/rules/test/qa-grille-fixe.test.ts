// Grille de temps fixe, entrées invalides, actions mal formées, renaissance après Envol,
// historique des notifications, migrate strict et BalanceError (docs/decisions.md, A2).
import { describe, expect, it } from "vitest";
import { BalanceError, createSave, deriveView, migrate, MigrationError, nextAttentionAt, reduce } from "../src/index";
import type { Action, Balance, GameEvent, Need, SaveState } from "../src/index";
import { at, B, clone, deepFreeze, fresh, gaugesOk, H, ID, MIN, NEVER, prng, T0, WORST } from "./qa-helpers";

const tick: Action = { type: "tick" };
const STEP = B.catchUp.stepSeconds * 1000;

/** Rejoue `times` avec un tick à chaque instant, en intercalant des projections (deriveView, nextAttentionAt). */
function run(s0: SaveState, times: number[], project: boolean): { state: SaveState; events: GameEvent[] } {
  let s = s0;
  const events: GameEvent[] = [];
  for (const t of times) {
    if (project) {
      deriveView(s, { nowMs: t, utcOffsetMin: 60 }, B);
      nextAttentionAt(s, { nowMs: t, utcOffsetMin: 60 }, B);
    }
    const r = reduce(s, tick, { nowMs: t, utcOffsetMin: 0 }, B);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe("grille fixe : n'importe quel découpage donne exactement le même état", () => {
  const starts: [string, () => SaveState][] = [
    ["malchance, malade dès que possible", () => fresh(WORST)],
    ["graine moyenne, jauges moyennes", () => fresh(123456, { pet: { gauges: { satiety: 40, hygiene: 45, happiness: 50 } } })],
    ["naissance à une heure non alignée (ms)", () => fresh(WORST, undefined, B, T0 + 12345)],
  ];
  for (const [name, make] of starts) {
    it(`${name} : une absence de 70 h découpée de trois façons (état, rng, événements, instants)`, () => {
      const base = make();
      const origin = base.pet.bornAt;
      const end = origin + 70 * H;
      const single = run(base, [end], false);
      const rnd = prng(7);
      const times: number[] = [];
      for (let t = origin; t < end; ) {
        t += Math.floor(rnd() * 3 * H) + 1; // pas arbitraires, souvent hors grille (ms comprises)
        times.push(Math.min(t, end));
      }
      const chopped = run(base, times, true);
      const minutes = run(base, Array.from({ length: 70 * 60 }, (_, i) => origin + (i + 1) * MIN), false);
      for (const other of [chopped, minutes]) {
        expect(other.state).toEqual(single.state);
        expect(other.state.pet.rng).toBe(single.state.pet.rng);
        expect(other.events.filter((e) => e.type !== "actionRefused")).toEqual(single.events);
      }
      expect((single.state.pet.lastUpdatedAt - origin) % STEP).toBe(0);
    });
  }

  it("lastUpdatedAt reste sur la grille bornAt + k × pas ; le reste est reporté à l'appel suivant", () => {
    const base = fresh(NEVER, undefined, B, T0 + 777);
    const a = reduce(base, tick, { nowMs: T0 + 777 + 59_999, utcOffsetMin: 0 }, B).state;
    expect(a.pet.lastUpdatedAt).toBe(T0 + 777); // moins d'un pas : rien n'avance
    const b = reduce(a, tick, { nowMs: T0 + 777 + 60_000, utcOffsetMin: 0 }, B).state;
    expect(b.pet.lastUpdatedAt).toBe(T0 + 777 + 60_000);
    const c = reduce(b, tick, { nowMs: T0 + 777 + 179_999, utcOffsetMin: 0 }, B).state;
    expect(c.pet.lastUpdatedAt).toBe(T0 + 777 + 120_000);
  });

  it("les actions s'appliquent au point de grille (cooldown posé à ce point)", () => {
    const base = fresh(NEVER, { pet: { gauges: { satiety: 40 } } });
    const r = reduce(base, { type: "feed", food: "meal" }, { nowMs: T0 + 150_000, utcOffsetMin: 0 }, B).state;
    expect(r.pet.lastUpdatedAt).toBe(T0 + 120_000);
    expect(r.pet.cooldowns["feed.meal"]).toBe(T0 + 120_000 + 5400_000);
  });

  it("stageChanged est émis au pas où le seuil d'âge est franchi, pas en fin de rattrapage", () => {
    const full = reduce(fresh(NEVER), tick, at(30 * H), B).events;
    const upTo24 = reduce(fresh(NEVER), tick, at(24 * H), B).events;
    const before24 = reduce(fresh(NEVER), tick, at(24 * H - STEP), B).events;
    const isChild = (e: GameEvent): boolean => e.type === "stageChanged" && e.to === "child";
    expect(before24.some(isChild)).toBe(false);
    expect(upTo24.filter(isChild)).toHaveLength(1);
    expect(upTo24[upTo24.length - 1]).toEqual({ type: "stageChanged", from: "baby", to: "child" }); // dernier événement du pas de 24 h
    expect(full.slice(0, upTo24.length)).toEqual(upTo24); // la suite du rattrapage ne le précède pas
    expect(full.filter(isChild)).toHaveLength(1);
  });

  it("nextAttentionAt renvoie un point de grille où le besoin est réellement apparu", () => {
    const base = fresh(NEVER, { pet: { gauges: { satiety: 37 } } }, B, T0 + 4321);
    const got = nextAttentionAt(base, { nowMs: T0 + 5000, utcOffsetMin: 0 }, B);
    expect(got).not.toBeNull();
    const when = got?.at ?? 0;
    expect((when - base.pet.bornAt) % STEP).toBe(0);
    const low = (s: SaveState): boolean => s.pet.gauges.satiety <= B.gauges.satiety.low;
    expect(low(reduce(base, tick, { nowMs: when, utcOffsetMin: 0 }, B).state)).toBe(true);
    expect(low(reduce(base, tick, { nowMs: when - STEP, utcOffsetMin: 0 }, B).state)).toBe(false);
  });

  it("le plafond maxSeconds s'applique par appel (documenté) : le temps au-delà est offert", () => {
    const bal: Balance = { ...clone(B), gauges: { ...clone(B).gauges, health: { ...B.gauges.health, decayPerHourWhenCritical: 0, decayPerHourWhenSick: 0 } } };
    const base = fresh(NEVER, undefined, bal);
    const one = reduce(base, tick, { nowMs: T0 + 30 * 24 * H, utcOffsetMin: 0 }, bal).state;
    expect(one.pet.lastUpdatedAt).toBe(T0 + 30 * 24 * H);
    const sevenDays = reduce(base, tick, { nowMs: T0 + 7 * 24 * H, utcOffsetMin: 0 }, bal).state;
    expect(one.pet.gauges).toEqual(sevenDays.pet.gauges);
  });
});

describe("entrées de temps invalides", () => {
  it("nowMs NaN, ±Infinity : heure reculée, rien n'avance, l'action est évaluée à lastUpdatedAt", () => {
    const base = fresh(NEVER, { pet: { gauges: { satiety: 40 } } });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = reduce(base, { type: "feed", food: "meal" }, { nowMs: bad, utcOffsetMin: 0 }, B);
      expect(r.state.pet.lastUpdatedAt).toBe(T0);
      expect(r.state.savedAt).toBe(T0);
      expect(r.state.pet.cooldowns["feed.meal"]).toBe(T0 + 5400_000);
      expect(gaugesOk(r.state)).toBeNull();
      expect(deriveView(base, { nowMs: bad, utcOffsetMin: 0 }, B)).toEqual(deriveView(base, at(0), B));
    }
  });
  it("nowMs fractionnaire : arrondi à l'entier inférieur", () => {
    const a = reduce(fresh(), tick, { nowMs: T0 + 3600000.9, utcOffsetMin: 0 }, B).state;
    const b = reduce(fresh(), tick, { nowMs: T0 + 3600000, utcOffsetMin: 0 }, B).state;
    expect(a).toEqual(b);
    expect(Number.isInteger(a.pet.lastUpdatedAt)).toBe(true);
  });
  it("utcOffsetMin non fini : traité comme 0", () => {
    const base = fresh(NEVER, { pet: { gauges: { satiety: 37 } } });
    const ref = nextAttentionAt(base, at(0, 0), B);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(nextAttentionAt(base, { nowMs: T0, utcOffsetMin: bad }, B)).toEqual(ref);
    }
  });
  it("seed non entière ou non finie : entier 32 bits non signé", () => {
    const seeds = [3.7, -1, -5.7, 2 ** 40 + 5, Number.NaN, Number.POSITIVE_INFINITY, 4294967296, 1e300];
    for (const seed of seeds) {
      const s = createSave({ id: ID, name: "x", seed, kind: "kawaii" }, at(0), B);
      expect(Number.isInteger(s.pet.rng) && s.pet.rng >= 0 && s.pet.rng <= 4294967295, String(seed)).toBe(true);
      expect(() => migrate(clone(s))).not.toThrow();
    }
    expect(createSave({ id: ID, name: "x", seed: 3.7, kind: "kawaii" }, at(0), B).pet.rng).toBe(3);
    expect(createSave({ id: ID, name: "x", seed: -1, kind: "kawaii" }, at(0), B).pet.rng).toBe(4294967295);
  });
});

describe("actions mal formées : jamais d'exception, jamais de raison undefined", () => {
  const flown = (): SaveState => fresh(NEVER, { pet: { life: "flown", flownAt: T0 } });
  const refusalOf = (s: SaveState, a: unknown): string | undefined => {
    const e = reduce(s, a as Action, at(H), B).events.find((x) => x.type === "actionRefused");
    return e && e.type === "actionRefused" ? e.reason : undefined;
  };
  it("type inconnu ou action absurde -> unknownAction", () => {
    for (const bad of [{ type: "explode" }, {}, null, undefined, 42, "tick", { type: 3 }, { type: "__proto__" }]) {
      expect(refusalOf(fresh(), bad), JSON.stringify(bad)).toBe("unknownAction");
      expect(refusalOf(flown(), bad), JSON.stringify(bad)).toBe("unknownAction");
    }
  });
  it("feed avec food invalide -> invalidAction, aucun effet", () => {
    for (const food of [undefined, "pizza", null, 1, "Meal"]) {
      const r = reduce(fresh(NEVER, { pet: { gauges: { satiety: 40 } } }), { type: "feed", food } as unknown as Action, at(H), B);
      expect(r.events).toContainEqual({ type: "actionRefused", action: "feed", reason: "invalidAction" });
      expect(r.state.pet.cooldowns["feed.snack"]).toBe(0);
    }
  });
  it("rebirth avec id ou nom manquant, vide ou non chaîne -> invalidIdentity, l'animal reste envolé", () => {
    const bads: unknown[] = [
      { type: "rebirth" },
      { type: "rebirth", id: "a", seed: 1 },
      { type: "rebirth", name: "N", seed: 1 },
      { type: "rebirth", id: "", name: "N", seed: 1 },
      { type: "rebirth", id: "a", name: "   ", seed: 1 },
      { type: "rebirth", id: 5, name: "N", seed: 1 },
      { type: "rebirth", id: "a", name: null, seed: 1 },
    ];
    for (const bad of bads) {
      const r = reduce(flown(), bad as Action, at(H), B);
      expect(r.events).toContainEqual({ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" });
      expect(r.state.pet.life).toBe("flown");
      expect(r.state.album).toHaveLength(0);
    }
  });
  it("fuzz : toute raison de refus est un texte de la liste documentée", () => {
    const REASONS = ["flown", "flownDuringCatchUp", "notFlown", "unknownAction", "invalidAction", "invalidIdentity", "asleep", "notHungry", "cooldown", "tooTired", "alreadyClean", "nothingToHeal", "notTired", "notAsleep", "exhausted"];
    const rnd = prng(99);
    const pool: unknown[] = [tick, { type: "feed", food: "meal" }, { type: "feed" }, { type: "play" }, { type: "clean" }, { type: "heal" }, { type: "sleep" }, { type: "wake" }, { type: "pet" }, { type: "rebirth" }, { type: "rebirth", id: "n", name: "N", seed: 2 }, { type: "x" }, null];
    let s = fresh(WORST);
    let now = T0;
    for (let i = 0; i < 3000; i++) {
      now += Math.floor(rnd() * 9 * H);
      const r = reduce(s, pool[Math.floor(rnd() * pool.length)] as Action, { nowMs: now, utcOffsetMin: 0 }, B);
      s = r.state;
      for (const e of r.events) if (e.type === "actionRefused") expect(REASONS).toContain(e.reason);
    }
  });
});

describe("renaissance : l'Envol doit être vu avant", () => {
  const dying = (): SaveState => fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 }, status: { sick: true, sickSince: T0 } } });
  const rebirth: Action = { type: "rebirth", id: "n-1", name: "Nova", seed: 9 };
  it("rebirth dans l'appel où l'animal s'envole : refusé, flewAway annoncé, l'album reste vide", () => {
    const r = reduce(dying(), rebirth, at(10 * H), B);
    expect(r.events).toContainEqual({ type: "flewAway" });
    expect(r.events).toContainEqual({ type: "actionRefused", action: "rebirth", reason: "flownDuringCatchUp" });
    expect(r.state.pet.life).toBe("flown");
    expect(r.state.album).toHaveLength(0);
  });
  it("toute autre action est aussi refusée (flownDuringCatchUp) ; tick passe le temps sans refus", () => {
    expect(reduce(dying(), { type: "clean" }, at(10 * H), B).events).toContainEqual({ type: "actionRefused", action: "clean", reason: "flownDuringCatchUp" });
    expect(reduce(dying(), tick, at(10 * H), B).events.some((e) => e.type === "actionRefused")).toBe(false);
  });
  it("après un tick qui montre l'Envol, rebirth est accepté", () => {
    const s = reduce(dying(), tick, at(10 * H), B).state;
    const r = reduce(s, rebirth, at(10 * H + MIN), B);
    expect(r.events).toContainEqual({ type: "reborn" });
    expect(r.state.album).toHaveLength(1);
  });
});

describe("nextAttentionAt avec historique des notifications", () => {
  const DAY = 24 * H;
  /** Satiété qui devient « basse » (35) vers 22:00 UTC : en heures calmes (21:30 -> 08:00). */
  const evening = (): SaveState => fresh(NEVER, { pet: { gauges: { satiety: 97.9 } } });
  const sent = (...e: [number, Need][]): { sent: { at: number; need: Need }[] } => ({ sent: e.map(([a, need]) => ({ at: a, need })) });

  it("sans historique : comportement inchangé (report à 08:00, besoins actifs supposés connus)", () => {
    expect(nextAttentionAt(evening(), at(0), B)).toEqual({ at: T0 + DAY, need: "satiety" });
    const s23 = reduce(evening(), tick, at(15 * H), B).state;
    expect(nextAttentionAt(s23, at(15 * H), B)).not.toEqual({ at: T0 + DAY, need: "satiety" });
  });
  it("besoin apparu à 22:00, reporté à 08:00, recalcul à 23:00 : reste dû tant qu'il n'est pas envoyé", () => {
    const s23 = reduce(evening(), tick, at(15 * H), B).state;
    expect(nextAttentionAt(s23, at(15 * H), B, { sent: [] })).toEqual({ at: T0 + DAY, need: "satiety" });
  });
  it("une fois envoyé (dans l'historique), il n'est plus dû", () => {
    const s23 = reduce(evening(), tick, at(15 * H), B).state;
    const got = nextAttentionAt(s23, at(15 * H), B, sent([T0 + DAY, "satiety"]));
    expect(got?.need).not.toBe("satiety");
  });
  it("besoin actif et non signalé, hors heures calmes : dû tout de suite (point de grille courant)", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 20 } } });
    expect(nextAttentionAt(s, at(0), B, { sent: [] })).toEqual({ at: T0, need: "satiety" });
  });
  it("une maladie nouvelle est due même si une ancienne a été signalée avant (sickSince)", () => {
    const s = fresh(NEVER, { pet: { status: { sick: true, sickSince: T0 } } });
    expect(nextAttentionAt(s, at(0), B, sent([T0 - 5 * H, "sick"]))).toEqual({ at: T0, need: "sick" });
    expect(nextAttentionAt(s, at(0), B, sent([T0, "sick"]))?.need).not.toBe("sick");
  });
  it("espacement minGapMinutes après le dernier envoi (tout besoin confondu)", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 38 } } }); // « bas » vers 08:40
    const free = nextAttentionAt(s, at(0), B, { sent: [] });
    expect(free?.at).toBeGreaterThan(T0);
    expect(free?.at).toBeLessThan(T0 + H);
    const gapped = nextAttentionAt(s, at(0), B, sent([T0, "happiness"]));
    expect(gapped).toEqual({ at: T0 + 180 * MIN, need: "satiety" });
  });
  it("plafond par jour local : maxPerDay - réserve pour les besoins ordinaires, report au lendemain 08:00", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 38 } } });
    const three = sent([T0 - 7 * H, "hygiene"], [T0 - 6 * H, "happiness"], [T0 - 5 * H, "hygiene"]);
    expect(nextAttentionAt(s, at(0), B, three)).toEqual({ at: T0 + DAY, need: "satiety" });
    const two = sent([T0 - 7 * H, "hygiene"], [T0 - 6 * H, "happiness"]);
    expect(nextAttentionAt(s, at(0), B, two)?.at).toBeLessThan(T0 + H);
  });
  it("la place réservée sert à « affaiblie », qui ignore aussi heures calmes et espacement", () => {
    // santé 46, satiété critique (déjà signalée) : « affaiblie » vers 08:46.
    const s = fresh(NEVER, { pet: { gauges: { satiety: 10, health: 46 } } });
    const known: [number, Need] = [T0 - 6 * H, "satiety"];
    const three = sent([T0 - 7 * H, "hygiene"], known, [T0 - 5 * H + MIN, "happiness"]);
    const w = nextAttentionAt(s, at(0), B, three);
    expect(w?.need).toBe("weak");
    expect(w?.at).toBeGreaterThan(T0);
    expect(w?.at).toBeLessThan(T0 + H);
    // 4 envois aujourd'hui : plafond total atteint, report à minuit local.
    const four = sent([T0 - 7 * H, "hygiene"], known, [T0 - 5 * H, "happiness"], [T0 - 4 * H, "hygiene"]);
    expect(nextAttentionAt(s, at(0), B, four)).toEqual({ at: T0 + 16 * H, need: "weak" });
    // en pleine nuit (heures calmes), « affaiblie » n'est pas reportée
    const nightStart = T0 + 16 * H; // 00:00 local
    const night = fresh(NEVER, { pet: { gauges: { satiety: 10, health: 46 } } }, B, nightStart);
    const nw = nextAttentionAt(night, { nowMs: nightStart, utcOffsetMin: 0 }, B, sent([nightStart - H, "satiety"]));
    expect(nw?.need).toBe("weak");
    expect((nw?.at ?? 0) - nightStart).toBeLessThan(H);
  });
  it("historique invalide ou ignorable : jamais d'exception", () => {
    const bad = { sent: [{ at: Number.NaN, need: "satiety" }, { at: 1, need: "zzz" }, null] } as unknown as { sent: { at: number; need: Need }[] };
    expect(() => nextAttentionAt(evening(), at(0), B, bad)).not.toThrow();
    expect(() => nextAttentionAt(evening(), at(0), B, undefined)).not.toThrow();
  });
});

describe("migrate strict, sans mutation, réaligné sur la grille", () => {
  type Raw = { pet: { status: Record<string, unknown>; cooldowns: Record<string, unknown> } & Record<string, unknown>; album: Record<string, unknown>[] };
  const raw = (): Raw => clone(fresh(NEVER, { album: [{ id: "a", name: "b", bornAt: 1, flownAt: 2, stage: "egg", kind: "kawaii" }] })) as unknown as Raw;
  const mut = (f: (r: Raw) => void): unknown => {
    const r = raw();
    f(r);
    return r;
  };
  const cases: [string, unknown][] = [
    ["messes au-dessus du maximum", mut((r) => { r.pet.status["messes"] = B.messes.max + 1; })],
    ["messes négatif", mut((r) => { r.pet.status["messes"] = -1; })],
    ["cooldown négatif", mut((r) => { r.pet.cooldowns["pet"] = -1; })],
    ["pet.id vide", mut((r) => { r.pet["id"] = ""; })],
    ["album[].id vide", mut((r) => { r.album[0]!["id"] = ""; })],
    ["life flown sans flownAt", mut((r) => { r.pet["life"] = "flown"; })],
    ["flownAt avec life alive", mut((r) => { r.pet["flownAt"] = 5; })],
    ["asleep sans asleepSince", mut((r) => { r.pet.status["asleep"] = true; })],
    ["asleepSince sans asleep", mut((r) => { r.pet.status["asleepSince"] = 5; })],
  ];
  for (const [name, r] of cases) {
    it(`refuse : ${name}`, () => {
      expect(() => migrate(r)).toThrow(MigrationError);
      try {
        migrate(r);
      } catch (e) {
        expect((e as MigrationError).code).toBe("invalid");
      }
    });
  }
  it("ne mute jamais l'objet reçu (entrée gelée en profondeur) et renvoie des copies", () => {
    const r = deepFreeze(raw());
    const s = migrate(r);
    expect(s.pet).not.toBe(r.pet);
    expect(s.album[0]).not.toBe(r.album[0]);
  });
  it("lastUpdatedAt hors grille : réaligné au point de grille inférieur", () => {
    const r = raw();
    r.pet["lastUpdatedAt"] = T0 + 3 * STEP + 41_234;
    expect(migrate(r).pet.lastUpdatedAt).toBe(T0 + 3 * STEP);
    expect(r.pet["lastUpdatedAt"]).toBe(T0 + 3 * STEP + 41_234); // l'entrée n'a pas bougé
    r.pet["lastUpdatedAt"] = T0 + 3 * STEP;
    expect(migrate(r).pet.lastUpdatedAt).toBe(T0 + 3 * STEP);
  });
});

describe("balance invalide : BalanceError, plus de boucle infinie", () => {
  const withCatchUp = (c: Partial<Balance["catchUp"]>): Balance => ({ ...clone(B), catchUp: { ...B.catchUp, ...c } });
  const bads: [string, Balance][] = [
    ["stepSeconds 0", withCatchUp({ stepSeconds: 0 })],
    ["stepSeconds négatif", withCatchUp({ stepSeconds: -60 })],
    ["stepSeconds non entier", withCatchUp({ stepSeconds: 0.5 })],
    ["stepSeconds NaN", withCatchUp({ stepSeconds: Number.NaN })],
    ["maxSeconds < stepSeconds", withCatchUp({ maxSeconds: 30 })],
    ["maxSeconds infini", withCatchUp({ maxSeconds: Number.POSITIVE_INFINITY })],
    ["seuils incohérents (critique > bas)", { ...clone(B), gauges: { ...clone(B).gauges, satiety: { ...B.gauges.satiety, critical: 50 } } }],
    ["envol incohérent", { ...clone(B), envol: { ...B.envol, flyWhenHealthAtOrBelow: 80 } }],
    ["balance vide", {} as Balance],
  ];
  for (const [name, bal] of bads) {
    it(`${name}`, () => {
      expect(() => reduce(fresh(), tick, at(H), bal)).toThrow(BalanceError);
      expect(() => deriveView(fresh(), at(H), bal)).toThrow(BalanceError);
      expect(() => nextAttentionAt(fresh(), at(H), bal)).toThrow(BalanceError);
      expect(() => createSave({ id: ID, name: "x", seed: 1 }, at(0), bal)).toThrow(BalanceError);
      expect(() => migrate(clone(fresh()), bal)).toThrow(BalanceError);
    });
  }
  it("la balance par défaut est valide", () => {
    expect(() => reduce(fresh(), tick, at(H), B)).not.toThrow();
  });
});
