// QA : déterminisme, pureté, temps (horloge, plafond, fuseau), bornes. Aucune horloge réelle.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSave, deriveView, migrate, nextAttentionAt, reduce } from "../src/index";
import type { Action, Balance, GameEvent, SaveState } from "../src/index";
import { at, B, clone, deepFreeze, fresh, gaugesOk, H, ID, MIN, NEVER, prng, T0, WORST } from "./qa-helpers";

const tick: Action = { type: "tick" };

describe("QA pureté : l'état, l'action, le temps et l'équilibrage reçus ne sont jamais mutés", () => {
  const actions: Action[] = [
    tick,
    { type: "feed", food: "meal" },
    { type: "feed", food: "snack" },
    { type: "play" },
    { type: "clean" },
    { type: "heal" },
    { type: "sleep" },
    { type: "wake" },
    { type: "pet" },
    { type: "rebirth", id: "x", name: "Nova", seed: 7 },
  ];
  const states: Record<string, () => SaveState> = {
    neuf: () => fresh(),
    "affamé et malade": () => fresh(WORST, { pet: { gauges: { satiety: 10, hygiene: 10, health: 70 }, status: { sick: true, sickSince: T0 } } }),
    endormi: () => fresh(NEVER, { pet: { gauges: { energy: 40 }, status: { asleep: true, asleepSince: T0 } } }),
    "presque envolé": () => fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 3 }, status: { sick: true, sickSince: T0 } } }),
    envolé: () => fresh(NEVER, { pet: { life: "flown", flownAt: T0 } }),
  };
  for (const [label, make] of Object.entries(states)) {
    for (const a of actions) {
      it(`reduce ${a.type} sur « ${label} » ne mute rien (gel profond) et renvoie une copie`, () => {
        const s = deepFreeze(make());
        const bal = deepFreeze(clone(B));
        const act = deepFreeze(clone(a));
        const time = deepFreeze({ nowMs: T0 + 5 * H, utcOffsetMin: 60 });
        const before = JSON.stringify(s);
        const out = reduce(s, act, time, bal);
        expect(JSON.stringify(s)).toBe(before);
        expect(out.state).not.toBe(s);
        expect(out.state.pet).not.toBe(s.pet);
        expect(out.state.pet.gauges).not.toBe(s.pet.gauges);
        expect(out.state.pet.status).not.toBe(s.pet.status);
        expect(out.state.pet.cooldowns).not.toBe(s.pet.cooldowns);
        expect(out.state.album).not.toBe(s.album);
        expect(out.state.settings).not.toBe(s.settings);
      });
    }
    it(`deriveView, nextAttentionAt et migrate ne mutent rien sur « ${label} »`, () => {
      const s = deepFreeze(make());
      const bal = deepFreeze(clone(B));
      const time = deepFreeze({ nowMs: T0 + 30 * H, utcOffsetMin: -300 });
      expect(() => deriveView(s, time, bal)).not.toThrow();
      expect(() => nextAttentionAt(s, time, bal)).not.toThrow();
      expect(() => migrate(deepFreeze(clone(s)))).not.toThrow();
    });
  }

  it("la sortie ne partage aucune référence mutable avec l'entrée : modifier la sortie ne touche pas l'entrée", () => {
    const s = fresh();
    const snapshot = JSON.stringify(s);
    const out = reduce(s, { type: "feed", food: "snack" }, at(1 * H), B).state;
    out.pet.gauges.satiety = -999;
    out.pet.cooldowns["feed.snack"] = -1;
    out.album.push({ id: "z", name: "z", bornAt: 0, flownAt: 0, stage: "egg", kind: "kawaii" });
    out.settings.sound = false;
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("QA déterminisme : même entrée, même sortie", () => {
  it("100 appels identiques donnent exactement le même résultat (événements compris)", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 20, hygiene: 20 } } });
    const ref = JSON.stringify(reduce(s, tick, at(60 * H), B));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(reduce(clone(s), tick, at(60 * H), B))).toBe(ref);
  });

  it("l'état survit à un aller-retour JSON (stockage) sans changer la suite de la partie", () => {
    let a = fresh(WORST, { pet: { gauges: { satiety: 30, hygiene: 30 } } });
    let b = migrate(clone(a));
    for (let i = 1; i <= 40; i++) {
      const act: Action = i % 7 === 0 ? { type: "feed", food: "snack" } : i % 5 === 0 ? { type: "clean" } : tick;
      const ra = reduce(a, act, at(i * 90 * MIN), B);
      const rb = reduce(b, act, at(i * 90 * MIN), B);
      expect(rb).toEqual(ra);
      a = ra.state;
      b = migrate(clone(rb.state)); // chaque étape repasse par le stockage
    }
    expect(b).toEqual(a);
  });

  it("le résultat de reduce ne dépend pas de utcOffsetMin (seul nextAttentionAt s'en sert)", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 20, hygiene: 20, happiness: 20 } } });
    const ref = reduce(s, tick, { nowMs: T0 + 50 * H, utcOffsetMin: 0 }, B);
    for (const off of [-720, -330, 60, 345, 840]) {
      expect(reduce(s, tick, { nowMs: T0 + 50 * H, utcOffsetMin: off }, B)).toEqual(ref);
    }
  });

  it("n'utilise pas d'horloge ni d'aléa ambiants : même résultat quand Date.now et Math.random sont piégés", () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    let calls = 0;
    Date.now = () => {
      calls++;
      return 1;
    };
    Math.random = () => {
      calls++;
      return 0.5;
    };
    try {
      const s = fresh(WORST, { pet: { gauges: { satiety: 10 } } });
      reduce(s, tick, at(30 * H), B);
      deriveView(s, at(30 * H), B);
      nextAttentionAt(s, at(0), B);
      migrate(clone(s));
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
    expect(calls).toBe(0);
  });
});

describe("QA D1 : arithmétique et dépendances interdites dans packages/rules/src", () => {
  const dir = fileURLToPath(new URL("../src/", import.meta.url));
  const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    it(`${f} : pas de pow/exp/log/trigo/sqrt, pas de **, pas de Date.now / Math.random / new Date / DOM / stockage`, () => {
      const code = strip(readFileSync(dir + f, "utf8"));
      expect(code).not.toMatch(/Math\.(pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sqrt|cbrt|hypot|random)\b/);
      expect(code).not.toMatch(/\*\*/);
      expect(code).not.toMatch(/Date\.now|new Date\b|performance\.now|\bwindow\b|\bdocument\b|localStorage|indexedDB|\bfetch\(/);
    });
  }
  it("le paquet n'a aucune dépendance d'exécution (D1)", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    expect(pkg["dependencies"] ?? {}).toEqual({});
  });
});

describe("QA temps : découper une absence ou la faire d'un coup", () => {
  const start = (): SaveState => fresh(NEVER);
  const eventsKey = (ev: GameEvent[]): string[] => ev.map((e) => JSON.stringify(e));

  it("découpage sur la grille de 60 s : état identique au bit près et mêmes événements, pour 5 découpages", () => {
    const total = 31 * H + 7 * MIN; // pas de seuil pile au bord
    const once = reduce(start(), tick, at(total), B);
    const rnd = prng(99);
    for (let trial = 0; trial < 5; trial++) {
      let s = start();
      const ev: GameEvent[] = [];
      let done = 0;
      while (done < total) {
        const chunk = Math.min(total - done, (1 + Math.floor(rnd() * 400)) * MIN);
        done += chunk;
        const r = reduce(s, tick, at(done), B);
        s = r.state;
        ev.push(...r.events);
      }
      expect(s).toEqual(once.state);
      // Les stageChanged sont émis en fin de chaque rattrapage (spec) : leur place relative
      // aux autres événements dépend du découpage, leur suite non.
      const notStage = (e: GameEvent): boolean => e.type !== "stageChanged";
      const onlyStage = (e: GameEvent): boolean => e.type === "stageChanged";
      expect(eventsKey(ev.filter(notStage))).toEqual(eventsKey(once.events.filter(notStage)));
      expect(eventsKey(ev.filter(onlyStage))).toEqual(eventsKey(once.events.filter(onlyStage)));
    }
  });

  it("découpage sur la grille avec malchance maximale (la maladie tire le même nombre de nombres)", () => {
    const total = 40 * H;
    const base = fresh(WORST);
    const once = reduce(base, tick, at(total), B);
    let s = base;
    for (let h = 1; h <= 40; h++) s = reduce(s, tick, at(h * H), B).state;
    expect(s).toEqual(once.state);
    expect(once.state.pet.status.sick).toBe(true);
  });

  it("découpage HORS grille (pas de 90 s, puis de 7 s) : écart borné, jauges à 0,05 près, mais rng et horodatages d'événements diffèrent", () => {
    // Écart connu et assumé : un pas final court décale la grille ; le nombre de tirages
    // aléatoires (un par pas) change, donc `pet.rng` diffère quand une jauge est critique.
    const total = 20 * H + 30; // 20 h 00 min 30 s
    const once = reduce(start(), tick, at(total), B).state;
    for (const chunkSec of [90, 7, 3599]) {
      let s = start();
      let t = 0;
      while (t < total) {
        t = Math.min(total, t + chunkSec * 1000);
        s = reduce(s, tick, at(t), B).state;
      }
      for (const k of ["satiety", "happiness", "energy", "hygiene", "health"] as const) {
        expect(Math.abs(s.pet.gauges[k] - once.pet.gauges[k])).toBeLessThan(0.05);
      }
      expect(s.pet.status.messes).toBe(once.pet.status.messes);
      expect(s.pet.lastUpdatedAt).toBe(once.pet.lastUpdatedAt);
    }
  });

  it("tick à l'instant exact de lastUpdatedAt : aucun changement, aucun événement", () => {
    const s = start();
    const r = reduce(s, tick, at(0), B);
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });

  it("cumul de ticks sur 7 jours en pas d'une minute (10 080 appels) = un seul appel de 7 jours", () => {
    const bal: Balance = { ...clone(B), gauges: { ...clone(B).gauges, health: { ...B.gauges.health, decayPerHourWhenCritical: 0, decayPerHourWhenSick: 0 } } };
    const base = fresh(NEVER, undefined, bal);
    const once = reduce(base, tick, at(168 * H), bal);
    expect(once.state.pet.life).toBe("alive");
    let s = base;
    for (let i = 1; i <= 10080; i++) s = reduce(s, tick, at(i * MIN), bal).state;
    expect(s).toEqual(once.state);
  });
});

describe("QA temps : horloge qui recule, plafond de 7 jours, valeurs de temps étranges", () => {
  it("horloge reculée de moins d'un pas : rien ne bouge, même après un état avancé ; action appliquée à lastUpdatedAt", () => {
    const s1 = reduce(fresh(), tick, at(10 * H), B).state;
    const back = reduce(s1, tick, at(10 * H - 30000), B);
    expect(back.state).toEqual(s1);
    expect(back.events).toEqual([]);
    const play = reduce(s1, { type: "pet" }, at(10 * H - 1), B);
    expect(play.state.pet.lastUpdatedAt).toBe(s1.pet.lastUpdatedAt);
    expect(play.state.savedAt).toBe(s1.savedAt);
    expect(play.state.pet.cooldowns["pet"]).toBe(s1.pet.lastUpdatedAt + 300000);
  });

  it("après un recul d'horloge (translation), le retour à l'heure d'origine ne rejoue pas le temps déjà vécu", () => {
    const s1 = reduce(fresh(), tick, at(10 * H), B).state;
    const s2 = reduce(s1, tick, at(3 * H), B).state; // recul de 7 h : translation, jauges intactes
    expect(s2.pet.gauges).toEqual(s1.pet.gauges);
    expect(s2.pet.lastUpdatedAt).toBe(T0 + 3 * H);
    const s3 = reduce(s2, tick, at(10 * H), B).state; // 7 h de plus de vie réelle : l'animal vit
    expect(s3.pet.lastUpdatedAt).toBe(T0 + 10 * H);
    expect(s3.pet.gauges.satiety).toBeLessThan(s1.pet.gauges.satiety);
  });

  it("nextAttentionAt et deriveView avec une horloge reculée : ni exception, ni retour dans le passé", () => {
    const s1 = reduce(fresh(), tick, at(10 * H), B).state;
    const a = nextAttentionAt(s1, at(1 * H), B);
    const b = nextAttentionAt(s1, at(10 * H), B);
    expect(a).toEqual(b);
    expect(deriveView(s1, at(1 * H), B)).toEqual(deriveView(s1, at(10 * H), B));
    if (a) expect(a.at).toBeGreaterThanOrEqual(s1.pet.lastUpdatedAt);
  });

  it("au-delà du plafond, rattraper 7 jours ou 30 jours donne les mêmes jauges (temps offert) ; lastUpdatedAt = maintenant", () => {
    // Équilibrage modifié pour que l'animal survive : pas d'Envol à cause du temps long.
    const bal: Balance = { ...clone(B), gauges: { ...clone(B).gauges, health: { ...B.gauges.health, decayPerHourWhenCritical: 0, decayPerHourWhenSick: 0 } } };
    const base = fresh(NEVER, undefined, bal);
    const a = reduce(base, tick, at(168 * H), bal).state;
    const b = reduce(base, tick, at(30 * 24 * H), bal).state;
    expect(b.pet.gauges).toEqual(a.pet.gauges);
    expect(b.pet.rng).toBe(a.pet.rng);
    expect(a.pet.life).toBe("alive");
    expect(b.pet.lastUpdatedAt).toBe(T0 + 30 * 24 * H);
    expect(b.savedAt).toBe(T0 + 30 * 24 * H);
  });

  it("à la limite exacte du plafond (168 h) et 1 ms au-delà : mêmes jauges", () => {
    const bal: Balance = { ...clone(B), gauges: { ...clone(B).gauges, health: { ...B.gauges.health, decayPerHourWhenCritical: 0, decayPerHourWhenSick: 0 } } };
    const a = reduce(fresh(NEVER, undefined, bal), tick, at(168 * H), bal).state;
    const b = reduce(fresh(NEVER, undefined, bal), tick, at(168 * H + 1), bal).state;
    expect(b.pet.gauges).toEqual(a.pet.gauges);
  });

  it("absence de 10 ans avec l'équilibrage par défaut : l'animal est envolé, état fini et cohérent, calcul rapide", () => {
    const t0 = Date.now(); // mesure de durée uniquement, hors règles
    const r = reduce(fresh(), tick, at(10 * 365 * 24 * H), B);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.state.pet.life).toBe("flown");
    expect(gaugesOk(r.state)).toBeNull();
    expect(r.events.filter((e) => e.type === "flewAway")).toHaveLength(1);
    expect(r.state.pet.stage).toBe("child"); // âge arrêté à l'Envol (T+77 h), pas à 10 ans
  });

  it("changement de fuseau (voyage, heure d'été) en cours de partie : le déroulé du jeu ne change pas", () => {
    let a = fresh(WORST, { pet: { gauges: { satiety: 25 } } });
    let b = a;
    const offsets = [0, 60, 120, -420, 120, 60, 0, 540];
    for (let i = 0; i < offsets.length; i++) {
      const t = at((i + 1) * 5 * H);
      a = reduce(a, i % 3 === 2 ? { type: "feed", food: "snack" } : tick, { ...t, utcOffsetMin: 0 }, B).state;
      b = reduce(b, i % 3 === 2 ? { type: "feed", food: "snack" } : tick, { ...t, utcOffsetMin: offsets[i] ?? 0 }, B).state;
    }
    expect(b).toEqual(a);
  });

  it("nowMs négatif (avant 1970) : états finis, mêmes règles", () => {
    const base = fresh(NEVER, undefined, B, -10 * 24 * H);
    const r = reduce(base, tick, { nowMs: -10 * 24 * H + 12 * H, utcOffsetMin: 0 }, B);
    expect(gaugesOk(r.state)).toBeNull();
    const ref = reduce(fresh(NEVER), tick, at(12 * H), B);
    expect(r.state.pet.gauges).toEqual(ref.state.pet.gauges);
    expect(nextAttentionAt(base, { nowMs: -10 * 24 * H, utcOffsetMin: 0 }, B)).not.toBeUndefined();
  });

  // Défaut trouvé : un `nowMs` non entier ou non fini corrompt l'état sauvegardé.
  it("DÉFAUT nowMs non entier : l'état produit doit rester sauvegardable (migrate le relit)", () => {
    const r = reduce(fresh(), tick, { nowMs: T0 + 3600000.5, utcOffsetMin: 0 }, B);
    expect(() => migrate(clone(r.state))).not.toThrow();
  });
  it("DÉFAUT nowMs NaN : l'état ne doit pas être corrompu (lastUpdatedAt et savedAt restent finis)", () => {
    const r = reduce(fresh(), tick, { nowMs: Number.NaN, utcOffsetMin: 0 }, B);
    expect(Number.isFinite(r.state.pet.lastUpdatedAt)).toBe(true);
    expect(Number.isFinite(r.state.savedAt)).toBe(true);
  });
  it("DÉFAUT nowMs Infinity : l'état ne doit pas être corrompu", () => {
    const r = reduce(fresh(), tick, { nowMs: Number.POSITIVE_INFINITY, utcOffsetMin: 0 }, B);
    expect(Number.isFinite(r.state.pet.lastUpdatedAt)).toBe(true);
  });
  it("nowMs NaN ne lève pas d'exception", () => {
    expect(() => reduce(fresh(), { type: "feed", food: "meal" }, { nowMs: Number.NaN, utcOffsetMin: 0 }, B)).not.toThrow();
  });
});

describe("QA bornes : jauges dans [0, 100], jamais NaN ni infinies", () => {
  it("20 000 pas de simulation avec actions aléatoires (dont absurdes) : invariants respectés à chaque étape", () => {
    const rnd = prng(2024);
    let s = fresh(WORST);
    let now = T0;
    let lastUpdated = s.pet.lastUpdatedAt;
    const kinds: Action[] = [
      tick,
      { type: "feed", food: "meal" },
      { type: "feed", food: "snack" },
      { type: "play" },
      { type: "clean" },
      { type: "heal" },
      { type: "sleep" },
      { type: "wake" },
      { type: "pet" },
      { type: "rebirth", id: "r", name: "Nova", seed: 3 },
    ];
    let rebirths = 0;
    for (let i = 0; i < 20000; i++) {
      const r = rnd();
      const dt = r < 0.7 ? Math.floor(rnd() * 15 * MIN) : r < 0.97 ? Math.floor(rnd() * 12 * H) : Math.floor(rnd() * 400 * H);
      now += dt;
      const act = kinds[Math.floor(rnd() * kinds.length)] ?? tick;
      const out = reduce(s, act, { nowMs: now, utcOffsetMin: Math.floor(rnd() * 1500) - 750 }, B);
      s = out.state;
      if (act.type === "rebirth" && out.events.some((e) => e.type === "reborn")) rebirths++;
      const bad = gaugesOk(s);
      expect(bad, `pas ${i} (${act.type})`).toBeNull();
      expect(s.pet.lastUpdatedAt).toBeGreaterThanOrEqual(lastUpdated);
      lastUpdated = s.pet.lastUpdatedAt;
      expect(s.pet.status.asleep).toBe(s.pet.status.asleepSince !== null);
      expect(s.pet.status.sick).toBe(s.pet.status.sickSince !== null);
      if (s.pet.life === "alive") {
        if (s.pet.gauges.health <= B.envol.weakWhenHealthAtOrBelow) expect(s.pet.status.weakSince, `pas ${i}`).not.toBeNull();
        if (s.pet.status.weakSince !== null) expect(s.pet.gauges.health).toBeLessThanOrEqual(B.envol.recoverWhenHealthAbove);
        expect(s.pet.gauges.health).toBeGreaterThan(0);
      } else {
        expect(s.pet.gauges.health).toBeLessThanOrEqual(0);
      }
      // L'état doit toujours pouvoir être relu par migrate (sauvegarde valide).
      if (i % 50 === 0) expect(() => migrate(clone(s)), `pas ${i}`).not.toThrow();
    }
    expect(rebirths).toBeGreaterThan(0); // la simulation a bien traversé des Envols
  });

  it("des milliers de pas à jauges extrêmes (0 et 100) ne sortent jamais des bornes", () => {
    for (const g of [0, 100]) {
      const s0 = fresh(NEVER, { pet: { gauges: { satiety: g, happiness: g, energy: g, hygiene: g, health: g === 0 ? 1 : 100 } } });
      let s = s0;
      for (let i = 1; i <= 3000; i++) {
        s = reduce(s, i % 11 === 0 ? { type: "feed", food: "snack" } : tick, at(i * 7 * MIN), B).state;
        expect(gaugesOk(s)).toBeNull();
      }
    }
  });

  it("l'énergie à 0 éveillé s'endort sans dépasser, et se réveille à 100 exactement", () => {
    let s = fresh(NEVER, { pet: { gauges: { energy: 0.01 } } });
    s = reduce(s, tick, at(MIN), B).state;
    expect(s.pet.status.asleep).toBe(true);
    s = reduce(s, tick, at(40 * H), B).state;
    expect(s.pet.status.asleep).toBe(false);
    expect(gaugesOk(s)).toBeNull();
  });
});

describe("QA valeurs hors contrat de l'état (robustesse de reduce)", () => {
  it("reduce, deriveView et nextAttentionAt ne lèvent pas sur un état migré tordu mais accepté", () => {
    const weird = fresh(NEVER, { pet: { status: { messProgressSeconds: 1e9, sick: true, sickSince: null } } });
    const m = migrate(clone(weird));
    expect(() => reduce(m, tick, at(5 * H), B)).not.toThrow();
    expect(() => deriveView(m, at(5 * H), B)).not.toThrow();
    expect(() => nextAttentionAt(m, at(0), B)).not.toThrow();
    expect(gaugesOk(reduce(m, tick, at(5 * H), B).state)).toBeNull();
  });
  it("createSave : l'identité n'est pas modifiée par un nom exotique", () => {
    const s = createSave({ id: ID, name: "Ëtoile 🌟 \u0000", seed: -5.7 }, { nowMs: T0, utcOffsetMin: 0 }, B);
    expect(s.pet.name).toBe("Ëtoile 🌟 \u0000");
    expect(Number.isInteger(s.pet.rng) && s.pet.rng >= 0 && s.pet.rng <= 4294967295).toBe(true);
  });
});
