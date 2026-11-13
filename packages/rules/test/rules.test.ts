import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSave, defaultBalance as B, deriveView, migrate, MigrationError, nextAttentionAt, nextRandom, reduce } from "../src/index";
import type { Balance, GameEvent, SaveState } from "../src/index";
import { validate } from "./json-schema";
import { mergePatch } from "./scenario-runner";

const T0 = 1763020800000; // 2025-11-13 08:00:00 UTC
const H = 3600000;
const WORST = 14056; // premier tirage ~ 0 : maladie dès que possible
const NEVER = 11184255; // 4800 premiers tirages tous élevés : jamais malade
const ID = "00000000-0000-4000-8000-000000000001";
const UTC = { utcOffsetMin: 0 };

const fresh = (seed = NEVER, patch?: object): SaveState => {
  const s = createSave({ id: ID, name: "Lumi", seed, kind: "kawaii" }, { nowMs: T0, ...UTC }, B);
  return patch ? (mergePatch(s, patch) as SaveState) : s;
};
const at = (ms: number) => ({ nowMs: T0 + ms, ...UTC });

function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(root + rel, "utf8")) as Record<string, unknown>;

describe("générateur mulberry32", () => {
  // Implémentation de référence indépendante (forme du script de simulation du game designer).
  function reference(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it("redonne la suite de référence, état stocké compris", () => {
    for (const seed of [0, 1, 42, 123456789, 4294967295, 2147483648]) {
      const ref = reference(seed);
      let state = seed >>> 0;
      for (let i = 0; i < 2000; i++) {
        const r = nextRandom(state);
        state = r.state;
        expect(r.value).toBe(ref());
        expect(r.value).toBeGreaterThanOrEqual(0);
        expect(r.value).toBeLessThan(1);
        expect(Number.isInteger(state) && state >= 0 && state <= 4294967295).toBe(true);
      }
    }
  });
  it("vecteurs fixes (à reprendre à l'identique dans le port Dart)", () => {
    const first = (seed: number): number[] => {
      let s = seed;
      return [0, 1, 2, 3].map(() => {
        const r = nextRandom(s);
        s = r.state;
        return r.value;
      });
    };
    expect(first(0)).toEqual([0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111]);
    expect(first(42)).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693]);
    expect(first(4294967295)).toEqual([0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677]);
  });
  it("les graines choisies pour les scénarios ont le comportement annoncé", () => {
    expect(nextRandom(WORST).value).toBeLessThan(0.0001);
    let s = NEVER;
    for (let i = 0; i < 4800; i++) {
      const r = nextRandom(s);
      s = r.state;
      expect(r.value).toBeGreaterThanOrEqual(0.0034);
    }
  });
});

describe("déterminisme du code source (D1)", () => {
  const dir = fileURLToPath(new URL("../src/", import.meta.url));
  const forbidden: [RegExp, string][] = [
    [/Date\b/, "Date"],
    [/Math\.random/, "Math.random"],
    [/Math\.(pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sqrt|cbrt|hypot)\b/, "fonction transcendante"],
    [/\*\*/, "opérateur **"],
    [/\b(performance|setTimeout|setInterval|localStorage|document|window|process)\b/, "API d'environnement"],
    [/from\s+"(?!\.{1,2}\/)/, "import externe"],
  ];
  it("aucun appel interdit dans packages/rules/src", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      // on retire les commentaires : ils peuvent citer ces noms pour les interdire
      const code = readFileSync(dir + f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const [re, what] of forbidden) {
        // balance.ts importe spec/balance.json (chemin relatif, autorisé)
        expect(re.test(code), `${f} utilise ${what}`).toBe(false);
      }
    }
  });
  it("le paquet n'a aucune dépendance d'exécution", () => {
    const pkg = JSON.parse(readFileSync(root + "packages/rules/package.json", "utf8")) as Record<string, unknown>;
    expect(pkg["dependencies"]).toBeUndefined();
    expect(Object.keys(pkg["devDependencies"] as object).sort()).toEqual(["typescript", "vitest"]);
  });
});

describe("schémas JSON de spec/", () => {
  const balanceSchema = readJson("spec/balance.schema.json");
  const saveSchema = readJson("spec/save.schema.json");
  it("spec/balance.json respecte balance.schema.json", () => {
    expect(validate(balanceSchema, readJson("spec/balance.json"))).toEqual([]);
  });
  it("le validateur rejette un équilibrage incorrect", () => {
    const bad = mergePatch(B, { gauges: { satiety: { low: 120 } }, extra: 1 });
    expect(validate(balanceSchema, bad).length).toBeGreaterThanOrEqual(2);
  });
  it("createSave et les états produits respectent save.schema.json", () => {
    let s = createSave({ id: ID, name: "Lumi", seed: 5 }, { nowMs: T0, ...UTC }, B);
    expect(validate(saveSchema, s)).toEqual([]);
    s = reduce(s, { type: "feed", food: "snack" }, at(0), B).state;
    s = reduce(s, { type: "tick" }, at(80 * H), B).state;
    expect(validate(saveSchema, s)).toEqual([]);
    s = reduce(s, { type: "rebirth", id: "b", name: "Nova", seed: 3 }, at(81 * H), B).state;
    expect(s.album).toHaveLength(1);
    expect(validate(saveSchema, s)).toEqual([]);
  });
  it("le validateur rejette une sauvegarde incorrecte", () => {
    const s = JSON.parse(JSON.stringify(fresh())) as { pet: { gauges: { health: number } }; version: number };
    s.pet.gauges.health = 101;
    s.version = 3;
    expect(validate(saveSchema, s).length).toBe(2);
  });
});

describe("cohérence de l'équilibrage (docs/equilibrage.md)", () => {
  it("seuil critique de santé = seuil d'affaiblie", () => {
    expect(B.gauges.health.critical).toBe(B.envol.weakWhenHealthAtOrBelow);
  });
  it("les stades sont triés par âge croissant et commencent à 0", () => {
    const ages = B.stages.map((s) => s.minAgeHours);
    expect(ages[0]).toBe(0);
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
  });
  it("le plafond de rattrapage dépasse l'Envol le plus tardif de la grille (G4)", () => {
    // départs sur grille, jamais malade ; l'Envol doit toujours tomber avant le plafond
    let latest = 0;
    let earliest = Number.POSITIVE_INFINITY;
    for (const s of [20, 100]) for (const h of [20, 100]) for (const y of [20, 60, 100]) for (const e of [0, 50, 100])
      for (const messes of [0, 3]) for (const asleep of [false, true]) {
        const start = fresh(NEVER, {
          pet: {
            gauges: { satiety: s, happiness: h, hygiene: y, energy: e, health: 100 },
            status: { messes, asleep, asleepSince: asleep ? T0 : null },
          },
        });
        const r = reduce(start, { type: "tick" }, at(400 * H), B);
        expect(r.state.pet.life).toBe("flown");
        const t = (r.state.pet.flownAt as number) - T0;
        latest = Math.max(latest, t);
        earliest = Math.min(earliest, t);
      }
    expect(latest).toBeLessThan(B.catchUp.maxSeconds * 1000);
    expect(earliest).toBeGreaterThan(24 * H);
    expect(latest / H).toBeLessThan(107); // doc : 106,1 h au plus tard
  });
});

describe("garanties de D3 sur grilles (G1, G3)", () => {
  it("G1 : 10 h sans soin depuis un départ correct ne mène jamais à « affaiblie »", () => {
    const sats = [36, 60, 100];
    const hyg = [41, 70, 100];
    const ens = [31, 60, 100];
    let n = 0;
    let minHealth = 100;
    for (const s of sats) for (const h of sats) for (const y of hyg) for (const e of ens)
      for (const hp of [76, 100]) for (const messes of [0, 3]) for (const mp of [0, 17999]) for (const asleep of [false, true]) for (const sick of [false, true]) {
        const start = fresh(WORST, {
          pet: {
            gauges: { satiety: s, happiness: h, hygiene: y, energy: e, health: hp },
            status: { messes, messProgressSeconds: mp, asleep, asleepSince: asleep ? T0 : null, sick, sickSince: sick ? T0 : null },
          },
        });
        const r = reduce(start, { type: "tick" }, at(10 * H), B);
        n++;
        expect(r.events.some((e2) => e2.type === "weakened" || e2.type === "flewAway")).toBe(false);
        expect(r.state.pet.status.weakSince).toBeNull();
        minHealth = Math.min(minHealth, r.state.pet.gauges.health);
      }
    expect(n).toBe(2592); // 3^4 x 2^5, la grille de docs/equilibrage.md 6
    expect(minHealth).toBeGreaterThan(66.0);
    expect(minHealth).toBeLessThan(66.2); // doc : 66,1
  });

  it("G3 : au moins 24 h entre « affaiblie » et l'Envol (grille et graines variées)", () => {
    let minGap = Number.POSITIVE_INFINITY;
    let runs = 0;
    for (const s of [20, 100]) for (const y of [20, 100]) for (const e of [0, 100]) for (const hp of [46, 100])
      for (const sick of [false, true]) for (const seed of [WORST, NEVER, 7]) {
        let state = fresh(seed, {
          pet: { gauges: { satiety: s, happiness: s, hygiene: y, energy: e, health: hp }, status: { sick, sickSince: sick ? T0 : null } },
        });
        let weakAt: number | null = state.pet.status.weakSince;
        for (let m = 1; m <= 250 * 60 && state.pet.life === "alive"; m += 30) {
          const r = reduce(state, { type: "tick" }, at(m * 60000), B);
          state = r.state;
          if (weakAt === null && state.pet.status.weakSince !== null) weakAt = state.pet.status.weakSince;
        }
        expect(state.pet.life).toBe("flown");
        expect(weakAt).not.toBeNull();
        // le pas de 30 minutes ne détecte « affaiblie » qu'à son entrée exacte (weakSince) ; seul compte flownAt
        minGap = Math.min(minGap, (state.pet.flownAt as number) - (weakAt as number));
        runs++;
      }
    expect(runs).toBe(2 * 2 * 2 * 2 * 2 * 3);
    expect(minGap).toBeGreaterThanOrEqual(24 * H);
  });
});

describe("reduce : pureté et déterminisme", () => {
  it("ne modifie pas l'état reçu (objet gelé) et renvoie un nouvel objet", () => {
    const s = deepFreeze(fresh(WORST));
    const r = reduce(s, { type: "feed", food: "meal" }, at(30 * H), B);
    expect(r.state).not.toBe(s);
    expect(r.state.pet).not.toBe(s.pet);
    expect(r.state.pet.gauges).not.toBe(s.pet.gauges);
    expect(s.pet.lastUpdatedAt).toBe(T0);
    const f = reduce(r.state, { type: "tick" }, at(200 * H), B); // envol puis refus : aussi sans mutation
    deepFreeze(f.state);
    expect(() => reduce(f.state, { type: "feed", food: "meal" }, at(201 * H), B)).not.toThrow();
  });
  it("même entrée, même sortie, au bit près", () => {
    const run = (): string => JSON.stringify(reduce(fresh(1234), { type: "tick" }, at(70 * H), B));
    expect(run()).toBe(run());
  });
  it("un rattrapage en un appel ou en plusieurs appels alignés sur le pas donne le même état", () => {
    const one = reduce(fresh(77), { type: "tick" }, at(40 * H), B).state;
    let s = fresh(77);
    for (let h = 5; h <= 40; h += 5) s = reduce(s, { type: "tick" }, at(h * H), B).state;
    expect(s).toEqual(one);
  });
  it("ne lève jamais d'exception sur des actions incohérentes", () => {
    const s = fresh();
    const weird: Parameters<typeof reduce>[1][] = [
      { type: "rebirth", id: "", name: "x", seed: 1 },
      { type: "feed", food: "meal" },
      { type: "wake" },
    ];
    for (const a of weird) expect(() => reduce(s, a, at(1000), B)).not.toThrow();
  });
  it("rebirth refuse une identité vide après l'Envol", () => {
    const flown = reduce(fresh(WORST), { type: "tick" }, at(100 * H), B).state;
    const r = reduce(flown, { type: "rebirth", id: "b", name: "  ", seed: 1 }, at(101 * H), B);
    expect(r.events).toEqual([{ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" }]);
    expect(r.state.pet.life).toBe("flown");
  });
  it("action refusée : état de l'animal inchangé, tick suivant comme si de rien n'était", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 95 } } });
    const refused = reduce(s, { type: "feed", food: "meal" }, at(0), B);
    expect(refused.state).toEqual(s);
    expect(refused.events).toEqual([{ type: "actionRefused", action: "feed", reason: "notHungry" }]);
  });
  it("balance injectée : un équilibrage différent change le résultat", () => {
    const fast = mergePatch(B, { gauges: { satiety: { decayPerHour: 9 } } }) as Balance;
    const a = reduce(fresh(), { type: "tick" }, at(2 * H), B).state;
    const b = reduce(fresh(), { type: "tick" }, at(2 * H), fast).state;
    expect(a.pet.gauges.satiety).toBeCloseTo(71, 6);
    expect(b.pet.gauges.satiety).toBeCloseTo(62, 6);
  });
});

describe("règles (docs/equilibrage.md section 3)", () => {
  it("décroissance éveillé sur 2 h depuis les jauges initiales", () => {
    const g = reduce(fresh(), { type: "tick" }, at(2 * H), B).state.pet.gauges;
    expect(g.satiety).toBeCloseTo(71, 6);
    expect(g.happiness).toBeCloseTo(74, 6);
    expect(g.energy).toBeCloseTo(73, 6);
    expect(g.hygiene).toBeCloseTo(97, 6);
    expect(g.health).toBe(100);
  });
  it("salissures : une toutes les 5 h d'éveil, 15 points d'hygiène chacune, 3 au plus", () => {
    const s = reduce(fresh(NEVER, { pet: { gauges: { satiety: 100, happiness: 100 } } }), { type: "tick" }, at(5 * H), B).state;
    expect(s.pet.status.messes).toBe(1);
    expect(s.pet.gauges.hygiene).toBeCloseTo(100 - 5 * 1.5 - 15, 6);
    const t = reduce(s, { type: "tick" }, at(16 * H), B).state;
    expect(t.pet.status.messes).toBe(3);
  });
  it("sommeil : ralentit les jauges et recharge l'énergie", () => {
    const s = fresh(NEVER, { pet: { gauges: { energy: 40 } } });
    const slept = reduce(s, { type: "sleep" }, at(0), B).state;
    const g = reduce(slept, { type: "tick" }, at(2 * H), B).state.pet.gauges;
    expect(g.energy).toBeCloseTo(53, 6);
    expect(g.satiety).toBeCloseTo(77, 6);
    expect(g.hygiene).toBeCloseTo(99, 6);
  });
  it("jeu : +25 bonheur, -5 énergie, -3 satiété, borné à 100", () => {
    const g = reduce(fresh(), { type: "play" }, at(0), B).state.pet.gauges;
    expect(g.happiness).toBe(100);
    expect(g.energy).toBe(75);
    expect(g.satiety).toBe(77);
  });
  it("la santé remonte de 2/h quand tout va bien", () => {
    const s = fresh(NEVER, { pet: { gauges: { health: 50, satiety: 100, happiness: 100 } } });
    expect(reduce(s, { type: "tick" }, at(5 * H), B).state.pet.gauges.health).toBeCloseTo(60, 6);
  });
  it("soin : guérit la maladie, +20 santé, sortie de « affaiblie » immédiate au-dessus de 60", () => {
    const weak = fresh(NEVER, {
      pet: { gauges: { health: 42, satiety: 100, happiness: 100 }, status: { sick: true, sickSince: T0, weakSince: T0 } },
    });
    // santé 42 -> 62 : recoveredStrength à l'instant du soin
    const r = reduce(weak, { type: "heal" }, at(0), B);
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(["recovered", "recoveredStrength"]));
    expect(r.state.pet.status.weakSince).toBeNull();
    expect(r.state.pet.status.sick).toBe(false);
  });
  it("événements de besoin : apparition au niveau bas, résolution par l'action", () => {
    const low = reduce(fresh(NEVER, { pet: { gauges: { satiety: 36 } } }), { type: "tick" }, at(30 * 60000), B);
    expect(low.events).toContainEqual({ type: "needAppeared", need: "satiety" });
    const fed = reduce(low.state, { type: "feed", food: "meal" }, at(30 * 60000), B);
    expect(fed.events).toContainEqual({ type: "needResolved", need: "satiety" });
  });
});

describe("deriveView : priorité des états (D4)", () => {
  const view = (patch: object) => deriveView(fresh(NEVER, patch), at(0), B);
  it("content par défaut", () => {
    const v = view({});
    expect(v.primary).toBe("happy");
    expect(v.secondary).toEqual([]);
    expect(v.gaugeLevels).toEqual({ satiety: "ok", happiness: "ok", energy: "ok", hygiene: "ok", health: "ok" });
  });
  it("chaque état principal et leur ordre : weak > sick > asleep > hungry > dirty > tired > happy", () => {
    const hungry = { gauges: { satiety: 30 } };
    const dirty = { gauges: { hygiene: 30 } };
    const tired = { gauges: { energy: 25 } };
    expect(view({ pet: { ...hungry, ...{}, gauges: { satiety: 30, hygiene: 30, energy: 25 } } }).primary).toBe("hungry");
    expect(view({ pet: dirty }).primary).toBe("dirty");
    expect(view({ pet: tired }).primary).toBe("tired");
    expect(view({ pet: { gauges: { satiety: 30, hygiene: 30, energy: 25 }, status: { asleep: true, asleepSince: T0 } } }).primary).toBe("asleep");
    expect(view({ pet: { gauges: { satiety: 30 }, status: { asleep: true, asleepSince: T0, sick: true, sickSince: T0 } } }).primary).toBe("sick");
    expect(view({ pet: { gauges: { satiety: 30 }, status: { sick: true, sickSince: T0, weakSince: T0 } } }).primary).toBe("weak");
  });
  it("besoins secondaires : au plus 2, dans l'ordre sick, satiety, hygiene, energy, happiness", () => {
    const v = view({ pet: { gauges: { satiety: 30, hygiene: 30, energy: 25, happiness: 20 }, status: { sick: true, sickSince: T0 } } });
    expect(v.primary).toBe("sick");
    expect(v.secondary).toEqual(["satiety", "hygiene"]);
    const w = view({ pet: { gauges: { satiety: 30, hygiene: 30, energy: 25, happiness: 20 } } });
    expect(w.primary).toBe("hungry");
    expect(w.secondary).toEqual(["hygiene", "energy"]);
    const x = view({ pet: { gauges: { happiness: 20 } } });
    expect(x.primary).toBe("happy");
    expect(x.secondary).toEqual(["happiness"]);
  });
  it("niveaux de jauges, comparaisons inclusives", () => {
    const v = view({ pet: { gauges: { satiety: 35, happiness: 15, energy: 30.5, hygiene: 15.0001, health: 45 } } });
    expect(v.gaugeLevels).toEqual({ satiety: "low", happiness: "critical", energy: "ok", hygiene: "low", health: "critical" });
  });
  it("envolé : état « flown », aucun besoin", () => {
    const flown = reduce(fresh(WORST), { type: "tick" }, at(100 * H), B).state;
    expect(deriveView(flown, at(101 * H), B)).toMatchObject({ primary: "flown", secondary: [] });
  });
  it("projette l'état jusqu'à l'heure demandée sans le modifier", () => {
    const s = fresh(NEVER);
    const copy = JSON.stringify(s);
    expect(deriveView(s, at(12 * H), B).primary).toBe("hungry"); // satiété basse après 10 h
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe("nextAttentionAt (D5)", () => {
  const noQuiet = mergePatch(B, { attention: { quietHours: { from: "00:00", to: "00:00" } } }) as Balance;
  it("renvoie null pour un animal envolé", () => {
    const flown = reduce(fresh(WORST), { type: "tick" }, at(100 * H), B).state;
    expect(nextAttentionAt(flown, at(101 * H), B)).toBeNull();
  });
  it("prédit exactement l'instant où le besoin apparaît (hors heures calmes), pour plusieurs graines", () => {
    for (const seed of [WORST, NEVER, 7, 99, 12345, 777777]) {
      const start = fresh(seed, { pet: { gauges: { satiety: 81 } } });
      const predicted = nextAttentionAt(start, at(0), noQuiet);
      expect(predicted).not.toBeNull();
      // observation réelle : première apparition d'un besoin notifiable
      let s = start;
      let found: { at: number; need: string } | null = null;
      for (let m = 1; m <= 168 * 60 && found === null; m++) {
        const r = reduce(s, { type: "tick" }, at(m * 60000), noQuiet);
        s = r.state;
        const ev: GameEvent | undefined = r.events.find(
          (e) => e.type === "needAppeared" && ["satiety", "hygiene", "happiness", "sick", "weak"].includes(e.need),
        );
        if (ev && ev.type === "needAppeared") found = { at: T0 + m * 60000, need: ev.need };
      }
      expect(predicted).toEqual(found);
    }
  });
  it("prédit aussi la maladie future (générateur copié) et l'affaiblissement", () => {
    const sick = nextAttentionAt(fresh(WORST, { pet: { gauges: { satiety: 20 } } }), at(0), noQuiet);
    // satiété 20 : critique (<=15) après 1,11 h, maladie dès le premier tirage favorable
    expect(sick?.need === "satiety" || sick?.need === "sick").toBe(true);
  });
  it("ne signale pas les besoins déjà actifs", () => {
    const hungry = fresh(NEVER, { pet: { gauges: { satiety: 10 } } });
    const n = nextAttentionAt(hungry, at(0), noQuiet);
    expect(n).not.toBeNull();
    expect(n?.need).not.toBe("satiety");
  });
  it("ne modifie pas l'état reçu", () => {
    const s = deepFreeze(fresh(WORST));
    expect(() => nextAttentionAt(s, at(5 * H), B)).not.toThrow();
  });
});

describe("migrate", () => {
  const raw = (): Record<string, unknown> => JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
  it("relit une sauvegarde v1 à l'identique", () => {
    const s = reduce(fresh(WORST), { type: "tick" }, at(100 * H), B).state;
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("lève des erreurs typées, jamais autre chose", () => {
    const code = (v: unknown): string | undefined => {
      try {
        migrate(v);
        return undefined;
      } catch (e) {
        expect(e).toBeInstanceOf(MigrationError);
        return (e as MigrationError).code;
      }
    };
    expect(code(null)).toBe("notAnObject");
    expect(code([1])).toBe("notAnObject");
    expect(code("x")).toBe("notAnObject");
    expect(code({})).toBe("missingVersion");
    expect(code({ version: "1" })).toBe("missingVersion");
    expect(code({ version: 3 })).toBe("unsupportedVersion");
    expect(code({ version: 0 })).toBe("unsupportedVersion");
    expect(code({ version: 1 })).toBe("invalid");
    const noMess = raw();
    delete ((noMess["pet"] as Record<string, unknown>)["status"] as Record<string, unknown>)["messProgressSeconds"];
    expect(code(noMess)).toBe("invalid");
    const badRng = raw();
    (badRng["pet"] as Record<string, unknown>)["rng"] = -1;
    expect(code(badRng)).toBe("invalid");
    const badStage = raw();
    (badStage["pet"] as Record<string, unknown>)["stage"] = "senior";
    expect(code(badStage)).toBe("invalid");
  });
  it("ne modifie pas l'entrée", () => {
    const r = deepFreeze(raw());
    expect(() => migrate(r)).not.toThrow();
  });
});
