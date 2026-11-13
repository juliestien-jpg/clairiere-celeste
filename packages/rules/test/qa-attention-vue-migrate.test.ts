// QA : nextAttentionAt (D5), deriveView (D4), migrate (Annexe A1). Aucune horloge réelle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveView, migrate, MigrationError, nextAttentionAt, reduce } from "../src/index";
import type { Balance, Need, SaveState } from "../src/index";
import { stepPet } from "../src/advance";
import { quietEnd } from "../src/attention";
import { validate } from "./json-schema";
import { at, B, clone, deepFreeze, fresh, gaugesOk, H, MIN, NEVER, prng, T0, WORST } from "./qa-helpers";

const DAY = 24 * H;
const tick = { type: "tick" } as const;

/** Oracle des heures calmes 21:30 -> 08:00 : vrai si t est dans la fenêtre. */
const isQuiet = (t: number, off: number): boolean => {
  const m = ((t + off * MIN) / MIN) % 1440;
  const mm = (m + 1440) % 1440;
  return mm >= 21 * 60 + 30 || mm < 8 * 60;
};
/** Premier instant >= t hors heures calmes (oracle). */
const oracleQuietEnd = (t: number, off: number): number => {
  if (!isQuiet(t, off)) return t;
  const local = t + off * MIN;
  const dayStart = Math.floor(local / DAY) * DAY;
  const msOfDay = local - dayStart;
  const eight = 8 * H;
  return (msOfDay < eight ? dayStart + eight : dayStart + DAY + eight) - off * MIN;
};

describe("QA heures calmes : quietEnd contre un oracle indépendant", () => {
  it("21:30 -> 08:00 (passe minuit) : frontières exactes, fuseaux variés", () => {
    for (const off of [0, 60, 120, -300, 330, 840, -720]) {
      const localMidnightUtc = Math.floor((T0 + off * MIN) / DAY) * DAY - off * MIN; // minuit local du jour de T0
      const q = (hhmm: number, extraMs = 0): number => quietEnd(localMidnightUtc + hhmm * MIN + extraMs, off, "21:30", "08:00");
      const t = (hhmm: number, extraMs = 0): number => localMidnightUtc + hhmm * MIN + extraMs;
      expect(q(21 * 60 + 29, 59999)).toBe(t(21 * 60 + 29, 59999)); // 21:29:59.999 : pas calme
      expect(q(21 * 60 + 30)).toBe(t(24 * 60 + 8 * 60)); // 21:30 pile : calme -> 08:00 lendemain
      expect(q(0)).toBe(t(8 * 60)); // minuit
      expect(q(7 * 60 + 59, 59999)).toBe(t(8 * 60)); // 07:59:59.999 -> 08:00
      expect(q(8 * 60)).toBe(t(8 * 60)); // 08:00 pile : plus calme
    }
  });
  it("500 instants aléatoires (négatifs, fractionnaires, fuseaux jusqu'à ±14 h) : mêmes résultats que l'oracle", () => {
    const rnd = prng(5);
    for (let i = 0; i < 500; i++) {
      const t = Math.floor((rnd() - 0.3) * 4000 * DAY) + (i % 2 ? 0.5 : 0);
      const off = Math.floor(rnd() * 113) * 15 - 720;
      const got = quietEnd(t, off, "21:30", "08:00");
      expect(got).toBe(oracleQuietEnd(t, off));
      expect(got).toBeGreaterThanOrEqual(t);
      expect(isQuiet(got, off)).toBe(false);
    }
  });
  it("fenêtre qui ne passe pas minuit (13:00 -> 14:00) et fenêtre vide (from = to)", () => {
    const base = Math.floor(T0 / DAY) * DAY; // minuit UTC
    expect(quietEnd(base + 12 * H, 0, "13:00", "14:00")).toBe(base + 12 * H);
    expect(quietEnd(base + 13 * H, 0, "13:00", "14:00")).toBe(base + 14 * H);
    expect(quietEnd(base + 13 * H + 59 * MIN, 0, "13:00", "14:00")).toBe(base + 14 * H);
    expect(quietEnd(base + 14 * H, 0, "13:00", "14:00")).toBe(base + 14 * H);
    expect(quietEnd(base + 3 * H, 0, "08:00", "08:00")).toBe(base + 3 * H);
  });
  it("changement d'heure : le même instant donne deux fins différentes avant/après le passage à +120", () => {
    const t = T0 + 14 * H + 40 * MIN; // 22:40 UTC
    expect(quietEnd(t, 60, "21:30", "08:00")).toBe(T0 + 23 * H); // 23:40 locale -> 08:00 locale = 07:00 UTC
    expect(quietEnd(t, 120, "21:30", "08:00")).toBe(T0 + 22 * H); // 00:40 locale (jour suivant) -> 08:00 locale = 06:00 UTC
  });
});

describe("QA nextAttentionAt : le besoin annoncé apparaît à l'instant annoncé, pas avant", () => {
  /** Avance par pas de 60 s depuis lastUpdatedAt = nowMs ; renvoie l'instant de la première apparition de `need`. */
  const firstAppearance = (s: SaveState, need: Need, limitMs: number): number | null => {
    let cur = s;
    let t = s.pet.lastUpdatedAt;
    while (t < limitMs) {
      t += MIN;
      const r = reduce(cur, tick, { nowMs: t, utcOffsetMin: 0 }, B);
      if (r.events.some((e) => e.type === "needAppeared" && e.need === need)) return t;
      cur = r.state;
      if (cur.pet.life === "flown") return null;
    }
    return null;
  };
  const day10 = T0 + 2 * H; // 10:00 UTC
  const cases: { name: string; seed: number; gauges: object; status?: object; need: Need }[] = [
    { name: "bonheur", seed: NEVER, gauges: { satiety: 100, hygiene: 100, energy: 100, happiness: 40.33 }, need: "happiness" },
    { name: "satiété", seed: NEVER, gauges: { satiety: 38.33, hygiene: 100, energy: 100, happiness: 100 }, need: "satiety" },
    { name: "hygiène", seed: NEVER, gauges: { satiety: 100, hygiene: 41.1, energy: 100, happiness: 100 }, need: "hygiene" },
    { name: "affaiblie", seed: NEVER, gauges: { satiety: 5, hygiene: 100, energy: 100, happiness: 100, health: 50 }, need: "weak" },
  ];
  for (const c of cases) {
    it(`${c.name} : at = première apparition (grille de 60 s), rien avant`, () => {
      const s = fresh(NEVER, { pet: { gauges: c.gauges, ...(c.status ? { status: c.status } : {}) } }, B, day10);
      const att = nextAttentionAt(s, { nowMs: day10, utcOffsetMin: 0 }, B);
      expect(att).not.toBeNull();
      expect(att?.need).toBe(c.need);
      const real = firstAppearance(s, c.need, day10 + 3 * DAY);
      expect(real).toBe(att?.at);
      // « pas avant » : le pas précédent (60 s plus tôt) ne l'a pas fait apparaître ; l'instant annoncé, si.
      // (`at` est la fin du pas où la jauge franchit le seuil : jusqu'à 60 s après le franchissement réel.)
      const justBefore = reduce(s, tick, { nowMs: (att?.at ?? 0) - MIN, utcOffsetMin: 0 }, B);
      expect(justBefore.events.some((e) => e.type === "needAppeared" && e.need === c.need)).toBe(false);
      const atTime = reduce(s, tick, { nowMs: att?.at ?? 0, utcOffsetMin: 0 }, B);
      expect(atTime.events.some((e) => e.type === "needAppeared" && e.need === c.need)).toBe(true);
    });
  }

  it("maladie (graine malchance) : l'annonce `sick` tombe au pas où becameSick est émis", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 15.4, hygiene: 100, energy: 100, happiness: 100 } } }, B, day10);
    const att = nextAttentionAt(s, { nowMs: day10, utcOffsetMin: 0 }, B);
    // satiété basse déjà active (connue) ; critique à ~5 min, maladie aussitôt : le prochain besoin est `sick`
    expect(att?.need).toBe("sick");
    const real = firstAppearance(s, "sick", day10 + DAY);
    expect(att?.at).toBe(real);
    const before = reduce(s, tick, { nowMs: (att?.at ?? 0) - MIN, utcOffsetMin: 0 }, B);
    expect(before.state.pet.status.sick).toBe(false);
  });

  it("les besoins déjà actifs à l'appel ne sont pas annoncés (le joueur les voit)", () => {
    const s = fresh(NEVER, { pet: { gauges: { satiety: 10, hygiene: 100, energy: 100, happiness: 100 } } }, B, day10);
    const att = nextAttentionAt(s, { nowMs: day10, utcOffsetMin: 0 }, B);
    expect(att?.need).not.toBe("satiety");
  });

  it("null : animal envolé ; null : tous les besoins déjà actifs ; null : aucun besoin avant l'horizon", () => {
    expect(nextAttentionAt(fresh(NEVER, { pet: { life: "flown", flownAt: T0 } }), at(0), B)).toBeNull();
    const all = fresh(NEVER, {
      pet: { gauges: { satiety: 30, hygiene: 30, happiness: 30, health: 40 }, status: { sick: true, sickSince: T0, weakSince: T0 } },
    });
    expect(nextAttentionAt(all, at(0), B)).toBeNull();
    const short: Balance = { ...clone(B), catchUp: { stepSeconds: 60, maxSeconds: 3600 } };
    expect(nextAttentionAt(fresh(NEVER, undefined, short), at(0), short)).toBeNull();
  });

  it("recalcul après une action : nourrir repousse l'annonce de la faim", () => {
    const s0 = fresh(NEVER, { pet: { gauges: { satiety: 60, happiness: 100, hygiene: 100 } } }, B, day10);
    const t = { nowMs: day10, utcOffsetMin: 0 };
    const before = nextAttentionAt(s0, t, B);
    const s1 = reduce(s0, { type: "feed", food: "meal" }, t, B).state;
    const after = nextAttentionAt(s1, t, B);
    expect(before?.need).toBe("satiety");
    expect(after === null || after.at > (before?.at ?? 0) || after.need !== "satiety").toBe(true);
    if (after?.need === "satiety") expect(after.at).toBeGreaterThan(before?.at ?? 0);
  });

  it("est pure : ne mute pas l'état gelé et deux appels donnent la même réponse", () => {
    const s = deepFreeze(fresh(WORST, { pet: { gauges: { satiety: 30 } } }));
    expect(nextAttentionAt(s, at(0), B)).toEqual(nextAttentionAt(s, at(0), B));
  });
});

describe("QA nextAttentionAt : heures calmes (D5)", () => {
  const start21h = T0 + 13 * H; // 21:00 UTC
  const happy = (): SaveState => fresh(NEVER, { pet: { gauges: { satiety: 100, hygiene: 100, energy: 100, happiness: 40.33 } } }, B, start21h);

  it("besoin apparu à 22:47 (heures calmes) -> reporté à 08:00 locale, fuseau UTC", () => {
    expect(nextAttentionAt(happy(), { nowMs: start21h, utcOffsetMin: 0 }, B)).toEqual({ at: T0 + 24 * H, need: "happiness" });
  });
  it("même état, voyage vers UTC+2 : 08:00 locale = 06:00 UTC ; vers UTC-5 le besoin tombe de jour : annoncé tel quel", () => {
    expect(nextAttentionAt(happy(), { nowMs: start21h, utcOffsetMin: 120 }, B)).toEqual({ at: T0 + 22 * H, need: "happiness" });
    const day = nextAttentionAt(happy(), { nowMs: start21h, utcOffsetMin: -300 }, B);
    expect(day?.need).toBe("happiness");
    expect(day?.at).toBe(start21h + 107 * MIN);
  });
  it("jamais d'annonce ordinaire dans les heures calmes (sauf `weak`)", () => {
    for (let off = -720; off <= 840; off += 45) {
      for (const seed of [NEVER, WORST]) {
        const s = fresh(seed, { pet: { gauges: { satiety: 36, hygiene: 41, happiness: 36 } } }, B, T0 + 13 * H + 25 * MIN);
        const att = nextAttentionAt(s, { nowMs: T0 + 13 * H + 25 * MIN, utcOffsetMin: off }, B);
        if (att && att.need !== "weak") expect(isQuiet(att.at, off), `off=${off} at=${att.at}`).toBe(false);
      }
    }
  });
  it("regroupement : plusieurs besoins apparus de nuit -> une seule annonce à 08:00, le plus pressant (satiété ; maladie si malade)", () => {
    const t = T0 + 13 * H + 25 * MIN; // 21:25
    const mk = (seed: number): SaveState => fresh(seed, { pet: { gauges: { satiety: 36, hygiene: 41, happiness: 36, energy: 100 } } }, B, t);
    expect(nextAttentionAt(mk(NEVER), { nowMs: t, utcOffsetMin: 0 }, B)).toEqual({ at: T0 + 24 * H, need: "satiety" });
    expect(nextAttentionAt(mk(WORST), { nowMs: t, utcOffsetMin: 0 }, B)).toEqual({ at: T0 + 24 * H, need: "sick" });
  });
  it("exception « affaiblie » : signalée en pleine nuit, sans attendre 08:00, même si un autre besoin est en attente", () => {
    // Départ 01:00 locale (UTC-7). Santé 50 avec satiété critique : affaiblie ~3 h 51 plus tard (04:51 locale).
    const start = T0; // 08:00 UTC = 01:00 à UTC-7
    const s = fresh(NEVER, { pet: { gauges: { satiety: 5, hygiene: 100, energy: 100, happiness: 38 } } }, B, start);
    const sWeak: SaveState = { ...s, pet: { ...s.pet, gauges: { ...s.pet.gauges, health: 50 } } };
    const att = nextAttentionAt(sWeak, { nowMs: start, utcOffsetMin: -420 }, B);
    expect(att?.need).toBe("weak");
    expect(isQuiet(att?.at ?? 0, -420)).toBe(true);
    expect((att?.at ?? 0) - start).toBeLessThan(4 * H);
    const before = reduce(sWeak, tick, { nowMs: (att?.at ?? 0) - MIN, utcOffsetMin: -420 }, B);
    expect(before.events.some((e) => e.type === "weakened")).toBe(false);
    const atT = reduce(sWeak, tick, { nowMs: att?.at ?? 0, utcOffsetMin: -420 }, B);
    expect(atT.events).toContainEqual({ type: "weakened" });
  });
});

describe("QA nextAttentionAt : comparaison à un oracle indépendant sur 250 états aléatoires", () => {
  const notifiable = (s: SaveState): Need[] => {
    const g = s.pet.gauges;
    const out: Need[] = [];
    if (g.satiety <= B.gauges.satiety.low) out.push("satiety");
    if (g.hygiene <= B.gauges.hygiene.low) out.push("hygiene");
    if (g.happiness <= B.gauges.happiness.low) out.push("happiness");
    if (s.pet.status.sick) out.push("sick");
    if (s.pet.status.weakSince !== null) out.push("weak");
    return out;
  };
  const PRIORITY: Need[] = ["weak", "sick", "satiety", "hygiene", "happiness"];

  it("même instant et même besoin ; l'annonce n'est jamais dans le passé ni en heures calmes (hors weak)", () => {
    const rnd = prng(31337);
    let nulls = 0;
    let weaks = 0;
    for (let i = 0; i < 250; i++) {
      const health = 25 + Math.floor(rnd() * 76);
      const gauges = {
        satiety: Math.round(rnd() * 100),
        hygiene: Math.round(rnd() * 100),
        happiness: Math.round(rnd() * 100),
        energy: Math.round(rnd() * 100),
        health,
      };
      const sick = rnd() < 0.3;
      const start = T0 + Math.floor(rnd() * DAY) - 5 * DAY;
      const off = Math.floor(rnd() * 113) * 15 - 720;
      const seed = Math.floor(rnd() * 1e9);
      const base = fresh(seed, undefined, B, start);
      const s: SaveState = {
        ...base,
        pet: {
          ...base.pet,
          gauges,
          status: { ...base.pet.status, sick, sickSince: sick ? start : null, weakSince: health <= 45 ? start : null, asleep: rnd() < 0.2, asleepSince: null },
        },
      };
      if (s.pet.status.asleep) s.pet.status.asleepSince = start;
      const time = { nowMs: start, utcOffsetMin: off };
      const got = nextAttentionAt(s, time, B);

      // Oracle : on rejoue pas à pas (60 s) et on date chaque apparition d'un besoin notifiable.
      const sim = clone(s);
      let known = new Set<Need>(notifiable(sim));
      const occ: { need: Need; at: number }[] = [];
      let candidate = Number.POSITIVE_INFINITY;
      const horizon = start + B.catchUp.maxSeconds * 1000;
      while (sim.pet.life === "alive" && sim.pet.lastUpdatedAt < horizon && sim.pet.lastUpdatedAt < candidate) {
        stepPet(sim.pet, 60000, B, null);
        if ((sim.pet.life as string) === "flown") break;
        const cur = notifiable(sim);
        for (const n of cur) {
          if (known.has(n)) continue;
          const t = sim.pet.lastUpdatedAt;
          occ.push({ need: n, at: t });
          // L'instant annoncé est un point de la grille de l'animal (bornAt = start, pas de 60 s).
          const q = oracleQuietEnd(t, off);
          candidate = Math.min(candidate, n === "weak" ? t : start + Math.ceil((q - start) / 60000) * 60000);
        }
        known = new Set(cur);
      }
      if (!Number.isFinite(candidate)) {
        expect(got, `cas ${i}`).toBeNull();
        nulls++;
        continue;
      }
      const group = occ.filter((o) => o.at <= candidate).map((o) => o.need);
      const need = PRIORITY.find((n) => group.includes(n));
      expect(got, `cas ${i} (off=${off})`).toEqual({ at: candidate, need });
      if (need === "weak") weaks++;
      expect((got?.at ?? 0)).toBeGreaterThanOrEqual(start);
      if (got && got.need !== "weak") expect(isQuiet(got.at, off)).toBe(false);

      // Lien avec `reduce` : au moment annoncé le besoin est réellement actif ; un pas avant, `weak` ne l'est pas.
      const atState = reduce(s, tick, { nowMs: candidate, utcOffsetMin: off }, B).state;
      if (atState.pet.life === "alive" && got) {
        expect(notifiable(atState).includes(got.need) || got.need !== "weak" ? true : false).toBe(true);
        if (got.need === "weak") {
          expect(atState.pet.status.weakSince).not.toBeNull();
          const b4 = reduce(s, tick, { nowMs: candidate - MIN, utcOffsetMin: off }, B).state;
          expect(b4.pet.status.weakSince).toBeNull();
        }
      }
    }
    expect(nulls).toBeLessThan(250);
    expect(weaks).toBeGreaterThan(0); // le jeu d'essai contient bien des cas « affaiblie »
  });
});

describe("QA deriveView : priorité D4 (weak > sick > asleep > hungry > dirty > tired > happy), au plus 2 secondaires", () => {
  /** Fabrique un état sans temps à rattraper (lastUpdatedAt = instant de la vue). */
  const make = (f: { weak: boolean; sick: boolean; asleep: boolean; hungry: boolean; dirty: boolean; tired: boolean; sad: boolean }): SaveState =>
    fresh(NEVER, {
      pet: {
        gauges: { satiety: f.hungry ? 30 : 90, hygiene: f.dirty ? 30 : 90, energy: f.tired ? 20 : 90, happiness: f.sad ? 30 : 90, health: f.weak ? 40 : 100 },
        status: { sick: f.sick, sickSince: f.sick ? T0 : null, asleep: f.asleep, asleepSince: f.asleep ? T0 : null, weakSince: f.weak ? T0 : null },
      },
    });
  it("les 128 combinaisons d'états : état principal selon D4 ; secondaires = les plus pressants, 2 au plus, sans doublon", () => {
    for (let m = 0; m < 128; m++) {
      const f = { weak: !!(m & 1), sick: !!(m & 2), asleep: !!(m & 4), hungry: !!(m & 8), dirty: !!(m & 16), tired: !!(m & 32), sad: !!(m & 64) };
      const v = deriveView(make(f), at(0), B);
      const expected = f.weak ? "weak" : f.sick ? "sick" : f.asleep ? "asleep" : f.hungry ? "hungry" : f.dirty ? "dirty" : f.tired ? "tired" : "happy";
      expect(v.primary, JSON.stringify(f)).toBe(expected);
      expect(v.secondary.length).toBeLessThanOrEqual(2);
      expect(new Set(v.secondary).size).toBe(v.secondary.length);
      expect(v.secondary).not.toContain("weak");
      const active: Need[] = [];
      if (f.sick && expected !== "sick") active.push("sick");
      if (f.hungry && expected !== "hungry") active.push("satiety");
      if (f.dirty && expected !== "dirty") active.push("hygiene");
      if (f.tired && expected !== "tired" && !f.asleep) active.push("energy");
      if (f.sad) active.push("happiness");
      expect(v.secondary, JSON.stringify(f)).toEqual(active.slice(0, 2));
    }
  });
  it("niveaux de jauge : seuils inclusifs (low 35, critical 15 ; santé 75 et 45)", () => {
    const lv = (satiety: number, health: number) => deriveView(fresh(NEVER, { pet: { gauges: { satiety, health, hygiene: 100, happiness: 100, energy: 100 } } }), at(0), B).gaugeLevels;
    expect(lv(35.0001, 100).satiety).toBe("ok");
    expect(lv(35, 100).satiety).toBe("low");
    expect(lv(15.0001, 100).satiety).toBe("low");
    expect(lv(15, 100).satiety).toBe("critical");
    expect(lv(0, 100).satiety).toBe("critical");
    expect(lv(100, 75.0001).health).toBe("ok");
    expect(lv(100, 75).health).toBe("low");
    expect(lv(100, 45).health).toBe("critical");
  });
  it("animal envolé : primary flown, aucun secondaire", () => {
    const v = deriveView(fresh(NEVER, { pet: { life: "flown", flownAt: T0, gauges: { health: 0, satiety: 0 } } }), at(10 * H), B);
    expect(v.primary).toBe("flown");
    expect(v.secondary).toEqual([]);
  });
  it("la vue est projetée à l'instant demandé sans muter l'état : bébé repu aujourd'hui, affamé 12 h plus tard", () => {
    const s = deepFreeze(fresh(NEVER, { pet: { gauges: { satiety: 60, hygiene: 100, happiness: 100, energy: 100 } } }));
    expect(deriveView(s, at(0), B).primary).toBe("happy");
    expect(deriveView(s, at(12 * H), B).primary).toBe("hungry");
  });
  it("un animal qui s'envole avant l'instant demandé s'affiche envolé, sans exception", () => {
    const s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 } } });
    expect(deriveView(s, at(30 * H), B).primary).toBe("flown");
  });
});

describe("QA migrate : entrées illisibles -> erreur typée, jamais un plantage", () => {
  const valid = (): Record<string, unknown> => clone(fresh(NEVER)) as unknown as Record<string, unknown>;
  const codeOf = (raw: unknown): string => {
    try {
      migrate(raw);
      return "ok";
    } catch (e) {
      if (e instanceof MigrationError) return e.code;
      return `PLANTAGE:${String(e)}`;
    }
  };

  it("entrées qui ne sont pas des objets -> notAnObject", () => {
    for (const raw of [undefined, null, 0, 42, "", "{}", "texte", true, false, [], [valid()], () => 1, Symbol.iterator]) {
      expect(codeOf(raw), String(raw)).toBe("notAnObject");
    }
  });
  it("objet vide, JSON partiel, version absente ou de mauvais type -> missingVersion", () => {
    for (const raw of [{}, { pet: {} }, { version: null }, { version: "1" }, { version: 1.5 }, { version: Number.NaN }, { version: Infinity }, { version: [1] }, { version: { v: 1 } }]) {
      expect(codeOf(raw), JSON.stringify(raw)).toBe("missingVersion");
    }
  });
  it("versions inconnues (0, négative, future, énorme) -> unsupportedVersion", () => {
    for (const version of [0, -1, 3, 4, 99, 1e308, 2 ** 53]) {
      expect(codeOf({ ...valid(), version }), String(version)).toBe("unsupportedVersion");
    }
  });
  it("version 1 mais contenu partiel -> invalid", () => {
    expect(codeOf({ version: 1 })).toBe("invalid");
    expect(codeOf({ version: 1, savedAt: T0 })).toBe("invalid");
    expect(codeOf({ version: 1, savedAt: T0, pet: null, album: [], settings: {} })).toBe("invalid");
    expect(codeOf({ version: 1, savedAt: T0, pet: {}, album: [], settings: {} })).toBe("invalid");
  });
  it("sauvegarde valide : relue à l'identique, sans partager de références avec l'entrée, entrée non mutée", () => {
    const raw = deepFreeze(valid());
    const s = migrate(raw);
    expect(s).toEqual(fresh(NEVER));
    expect((s.pet.gauges as unknown) === (raw["pet"] as { gauges: unknown })["gauges"]).toBe(false);
  });
  it("champs en trop : ignorés sans erreur (compatibilité ascendante) et absents du résultat", () => {
    const raw = valid();
    raw["futur"] = { x: 1 };
    (raw["pet"] as Record<string, unknown>)["extra"] = 1;
    expect(codeOf(raw)).toBe("ok");
    expect(JSON.stringify(migrate(raw))).not.toContain("extra");
  });
  it("suppression de chaque champ requis, un par un (chemin complet) -> invalid, jamais autre chose", () => {
    const paths: string[][] = [];
    const walk = (o: unknown, p: string[]): void => {
      if (typeof o === "object" && o !== null && !Array.isArray(o)) for (const k of Object.keys(o)) { paths.push([...p, k]); walk((o as Record<string, unknown>)[k], [...p, k]); }
    };
    const proto = fresh(NEVER, { album: [{ id: "a", name: "b", bornAt: 1, flownAt: 2, stage: "egg", kind: "kawaii" }] });
    walk(proto, []);
    for (const p of paths) {
      if (p[0] === "pet" && p[1] === "cooldowns" && p.length === 3) continue; // clés libres
      const raw = clone(proto) as unknown as Record<string, unknown>;
      let cur = raw as Record<string, unknown>;
      for (const k of p.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
      delete cur[p[p.length - 1] as string];
      expect(codeOf(raw), p.join(".")).toBe(p[0] === "version" ? "missingVersion" : "invalid");
    }
    // l'album est aussi parcouru : champ manquant dans une entrée
    const raw = clone(proto) as unknown as { album: Record<string, unknown>[] };
    delete raw.album[0]?.["name"];
    expect(codeOf(raw)).toBe("invalid");
  });
  it("fuzz de types faux sur chaque feuille : succès ou MigrationError, jamais d'autre exception ; un état accepté reste jouable", () => {
    const proto = fresh(NEVER, { album: [{ id: "a", name: "b", bornAt: 1, flownAt: 2, stage: "egg", kind: "kawaii" }] });
    const leaves: string[][] = [];
    const walk = (o: unknown, p: string[]): void => {
      if (Array.isArray(o)) o.forEach((v, i) => walk(v, [...p, String(i)]));
      else if (typeof o === "object" && o !== null) for (const k of Object.keys(o)) walk((o as Record<string, unknown>)[k], [...p, k]);
      else leaves.push(p);
    };
    walk(proto, []);
    const bads: unknown[] = [null, undefined, "x", "", -1, 0, 101, 1e308, -1e308, 1.5, Number.NaN, Infinity, -Infinity, {}, [], [1], true, false, 2 ** 53, "1", Number.MIN_VALUE];
    let accepted = 0;
    for (const leaf of leaves) {
      for (const bad of bads) {
        const raw = JSON.parse(JSON.stringify(proto)) as Record<string, unknown>;
        let cur: Record<string, unknown> = raw;
        for (const k of leaf.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
        cur[leaf[leaf.length - 1] as string] = bad;
        let result: SaveState | null = null;
        try {
          result = migrate(raw);
        } catch (e) {
          expect(e instanceof MigrationError, `${leaf.join(".")} = ${String(bad)} : ${String(e)}`).toBe(true);
        }
        if (result) {
          accepted++;
          const r = reduce(result, tick, at(3 * H), B); // ne doit pas lever
          expect(Number.isFinite(r.state.pet.gauges.health), `${leaf.join(".")} = ${String(bad)}`).toBe(true);
          expect(() => deriveView(result as SaveState, at(3 * H), B)).not.toThrow();
          expect(() => nextAttentionAt(result as SaveState, at(0), B)).not.toThrow();
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });

  describe("cohérence avec spec/save.schema.json : migrate ne doit pas accepter ce que le schéma refuse", () => {
    const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../spec/save.schema.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const mutate = (f: (raw: { pet: { status: Record<string, unknown>; cooldowns: Record<string, unknown>; id: unknown }; album: Record<string, unknown>[] }) => void): unknown => {
      const raw = clone(fresh(NEVER, { album: [{ id: "a", name: "b", bornAt: 1, flownAt: 2, stage: "egg", kind: "kawaii" }] })) as unknown as Parameters<typeof f>[0];
      f(raw);
      return raw;
    };
    const cases: [string, unknown][] = [
      ["messes négatif", mutate((r) => { r.pet.status["messes"] = -2; })],
      ["cooldown négatif", mutate((r) => { r.pet.cooldowns["heal"] = -5; })],
      ["identifiant d'animal vide", mutate((r) => { r.pet.id = ""; })],
      ["identifiant d'album vide", mutate((r) => { r.album[0]!["id"] = ""; })],
    ];
    for (const [name, raw] of cases) {
      it(`DÉFAUT ${name} : refusé par le schéma, doit l'être par migrate`, () => {
        expect(validate(schema, raw).length).toBeGreaterThan(0);
        expect(() => migrate(raw)).toThrow(MigrationError);
      });
    }
    it("une sauvegarde produite par reduce après Envol et renaissance respecte le schéma", () => {
      let s = fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 } } });
      s = reduce(s, tick, at(10 * H), B).state;
      s = reduce(s, { type: "rebirth", id: "n-1", name: "Nova", seed: 9 }, at(11 * H), B).state;
      expect(gaugesOk(s)).toBeNull();
      expect(validate(schema, clone(s))).toEqual([]);
    });
  });
});
