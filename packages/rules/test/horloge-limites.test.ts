// Translation de la chronologie (horloge reculée, A2) et limites de taille (A1, LIMITS).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSave, InvalidIdentityError, LIMITS, migrate, MigrationError, reduce } from "../src/index";
import type { Action, GameEvent, SaveState } from "../src/index";
import { at, B, clone, deepFreeze, fresh, H, ID, MIN, NEVER, T0, WORST } from "./qa-helpers";

const tick: Action = { type: "tick" };
const STEP = B.catchUp.stepSeconds * 1000;

/** Retire de l'état tous les instants, pour comparer « hors instants ». */
function withoutInstants(s: SaveState): unknown {
  const c = clone(s) as SaveState;
  const p = c.pet as unknown as Record<string, unknown>;
  for (const k of ["bornAt", "stageSince", "lastUpdatedAt", "flownAt"]) delete p[k];
  for (const k of ["asleepSince", "sickSince", "weakSince"]) delete (c.pet.status as unknown as Record<string, unknown>)[k];
  c.pet.cooldowns = Object.fromEntries(Object.entries(c.pet.cooldowns).map(([k, v]) => [k, v === 0 ? 0 : 1]));
  delete (c as unknown as Record<string, unknown>)["savedAt"];
  return c;
}

describe("translation de la chronologie (horloge reculée)", () => {
  it("horloge avancée puis remise à l'heure : même état hors instants, mêmes écarts relatifs, recharges terminées normalement", () => {
    const base = fresh(NEVER, { pet: { gauges: { satiety: 30 } } });
    const advanced = reduce(base, { type: "feed", food: "snack" }, at(20 * H), B).state; // heure fausse
    const sick = reduce(advanced, { type: "pet" }, at(20 * H), B).state;
    const r = reduce(sick, tick, at(2 * H), B); // heure réelle
    const d = -18 * H;
    expect(r.events).toEqual([{ type: "clockAdjusted", deltaMs: d }]);
    expect(withoutInstants(r.state)).toEqual(withoutInstants(sick));
    expect(r.state.pet.rng).toBe(sick.pet.rng);
    expect(r.state.pet.lastUpdatedAt).toBe(T0 + 2 * H);
    expect(r.state.pet.bornAt).toBe(sick.pet.bornAt + d);
    expect(r.state.pet.stageSince).toBe(sick.pet.stageSince + d);
    expect(r.state.savedAt).toBe(sick.savedAt + d);
    for (const k of Object.keys(sick.pet.cooldowns)) {
      const c0 = sick.pet.cooldowns[k] ?? 0;
      expect(r.state.pet.cooldowns[k]).toBe(c0 === 0 ? 0 : c0 + d);
    }
    // la recharge de la caresse se termine à sa durée réelle
    const wait = (sick.pet.cooldowns["pet"] ?? 0) - sick.pet.lastUpdatedAt;
    expect(wait).toBeGreaterThan(0);
    const early = reduce(r.state, { type: "pet" }, at(2 * H + wait - 60000), B);
    expect(early.events.some((e) => e.type === "actionRefused")).toBe(true);
    const ontime = reduce(r.state, { type: "pet" }, at(2 * H + wait), B);
    expect(ontime.events.some((e) => e.type === "actionRefused")).toBe(false);
  });

  it("pas de translation sous un pas, translation dès un pas, delta multiple du pas, lastUpdatedAt = dernier point de grille <= nowMs", () => {
    const s = reduce(fresh(), tick, at(5 * H), B).state;
    expect(reduce(s, tick, at(5 * H - STEP + 1), B).events).toEqual([]);
    expect(reduce(s, tick, at(5 * H - STEP), B).events).toEqual([{ type: "clockAdjusted", deltaMs: -STEP }]);
    for (const back of [STEP, STEP + 1, 90000, 123456, 3 * H + 17]) {
      const now = 5 * H - back;
      const r = reduce(s, tick, at(now), B);
      const ev = r.events[0] as Extract<GameEvent, { type: "clockAdjusted" }>;
      expect(ev.type).toBe("clockAdjusted");
      expect(Math.abs(ev.deltaMs % STEP)).toBe(0);
      expect(ev.deltaMs).toBeLessThan(0);
      expect(r.state.pet.lastUpdatedAt).toBeLessThanOrEqual(T0 + now);
      expect(T0 + now - r.state.pet.lastUpdatedAt).toBeLessThan(STEP);
      expect((r.state.pet.lastUpdatedAt - r.state.pet.bornAt) % STEP).toBe(0);
      expect(r.state.pet.gauges).toEqual(s.pet.gauges);
    }
  });

  it("la translation ne mute pas l'entrée et ne touche pas l'album ni les réglages", () => {
    const s = deepFreeze(fresh(NEVER, { album: [{ id: "x", name: "Vieux", bornAt: 1, flownAt: 2, stage: "adult", kind: "kawaii" }] }));
    const r = reduce(deepFreeze(reduce(s, tick, at(3 * H), B).state), tick, at(1 * H), B);
    expect(r.state.album).toEqual(s.album);
    expect(r.state.settings).toEqual(s.settings);
  });

  it("recul avant bornAt : bornAt est décalé aussi, âge et stade conservés", () => {
    const s = reduce(fresh(), tick, at(2 * H), B).state;
    const r = reduce(s, tick, at(-3 * H), B);
    expect(r.state.pet.lastUpdatedAt).toBe(T0 - 3 * H);
    expect(r.state.pet.bornAt).toBe(T0 - 5 * H);
    expect(r.state.pet.stage).toBe(s.pet.stage);
    expect(r.state.pet.lastUpdatedAt - r.state.pet.bornAt).toBe(s.pet.lastUpdatedAt - s.pet.bornAt);
  });

  it("l'action de l'appel est évaluée au nouveau lastUpdatedAt ; événements : clockAdjusted d'abord", () => {
    const s = reduce(fresh(NEVER, { pet: { gauges: { satiety: 20 } } }), tick, at(4 * H), B).state;
    const r = reduce(s, { type: "feed", food: "meal" }, at(1 * H + 12345), B);
    expect(r.events[0]).toEqual({ type: "clockAdjusted", deltaMs: -3 * H });
    expect(r.state.pet.lastUpdatedAt).toBe(T0 + 1 * H);
    expect(r.state.pet.cooldowns["feed.meal"]).toBe(T0 + 1 * H + (B.actions["feed.meal"].cooldownSeconds) * 1000);
  });

  it("animal envolé : flownAt est décalé aussi, renaissance au nouveau lastUpdatedAt", () => {
    const f = reduce(fresh(WORST, { pet: { gauges: { satiety: 0, hygiene: 0, happiness: 0, health: 1 }, status: { sick: true, sickSince: T0 } } }), tick, at(10 * H), B).state;
    expect(f.pet.life).toBe("flown");
    const r = reduce(f, tick, at(-2 * H), B);
    const d = (r.events[0] as { deltaMs: number }).deltaMs;
    expect(r.events[0]?.type).toBe("clockAdjusted");
    expect(r.state.pet.flownAt).toBe((f.pet.flownAt ?? 0) + d);
    expect(r.state.pet.lastUpdatedAt).toBe(r.state.pet.flownAt);
    expect(r.events[1]).toEqual({ type: "actionRefused", action: "tick", reason: "flown" });
    const b = reduce(r.state, { type: "rebirth", id: "n", name: "Nova", seed: 1, kind: "kawaii" }, at(-2 * H), B);
    expect(b.state.album.at(-1)?.flownAt).toBe(r.state.pet.flownAt);
    expect(b.state.pet.bornAt).toBe(r.state.pet.lastUpdatedAt);
  });

  it("heure non finie : pas de translation ; heure avancée : comportement inchangé (plafond appliqué)", () => {
    const s = reduce(fresh(), tick, at(5 * H), B).state;
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      const r = reduce(s, tick, { nowMs: bad, utcOffsetMin: 0 }, B);
      expect(r.events).toEqual([]);
      expect(r.state).toEqual(s);
    }
    const far = reduce(s, tick, at(5 * H + 30 * 24 * H), B);
    expect(far.events.some((e) => e.type === "clockAdjusted")).toBe(false);
  });

  it("valeur extrême finie : pas de translation (entier non sûr), l'état reste valide", () => {
    const s = reduce(fresh(), tick, at(5 * H), B).state;
    const r = reduce(s, tick, { nowMs: -1e300, utcOffsetMin: 0 }, B);
    expect(r.events).toEqual([]);
    expect(r.state).toEqual(s);
  });

  it("un nowMs fractionnaire est arrondi à l'entier inférieur avant la comparaison", () => {
    const s = reduce(fresh(), tick, at(5 * H), B).state;
    expect(reduce(s, tick, { nowMs: T0 + 5 * H - STEP + 0.5, utcOffsetMin: 0 }, B).events).toEqual([{ type: "clockAdjusted", deltaMs: -STEP }]);
  });

  it("idempotence : rejouer la même heure reculée ne translate pas deux fois", () => {
    const s = reduce(fresh(), tick, at(5 * H), B).state;
    const r1 = reduce(s, tick, at(2 * H), B);
    const r2 = reduce(r1.state, tick, at(2 * H), B);
    expect(r2.events).toEqual([]);
    expect(r2.state).toEqual(r1.state);
  });

  it("après translation, le cooldown nul reste nul et un cooldown dans le passé ne devient jamais un refus", () => {
    const s = reduce(fresh(), { type: "pet" }, at(10 * MIN), B).state;
    const s2 = reduce(s, tick, at(2 * H), B).state; // la caresse (5 min) est terminée
    const r = reduce(s2, { type: "pet" }, at(1 * H), B);
    expect(r.events.map((e) => e.type)).toEqual(["clockAdjusted"]);
  });
});

describe("limites de taille", () => {
  const name40 = "N".repeat(40);
  const raw = (): Record<string, unknown> => clone(fresh()) as unknown as Record<string, unknown>;
  const withPet = (patch: Record<string, unknown>): Record<string, unknown> => {
    const r = raw();
    Object.assign(r["pet"] as object, patch);
    return r;
  };
  const code = (f: () => unknown): string | null => {
    try {
      f();
      return null;
    } catch (e) {
      return e instanceof MigrationError ? e.code : `autre:${String(e)}`;
    }
  };

  it("LIMITS exportées avec les valeurs décidées", () => {
    expect(LIMITS).toEqual({ nameMaxLength: 40, textMaxLength: 128, albumMaxEntries: 1000, cooldownsMaxEntries: 32 });
  });

  it("LIMITS correspond à spec/save.schema.json", () => {
    const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../spec/save.schema.json", import.meta.url)), "utf8")) as {
      properties: { album: { maxItems: number } };
      $defs: { pet: { properties: { name: { maxLength: number }; id: { maxLength: number }; cooldowns: { maxProperties: number } } }; albumEntry: { properties: { name: { maxLength: number }; id: { maxLength: number } } } };
    };
    expect(schema.properties.album.maxItems).toBe(LIMITS.albumMaxEntries);
    expect(schema.$defs.pet.properties.id.maxLength).toBe(LIMITS.textMaxLength);
    expect(schema.$defs.pet.properties.name.maxLength).toBe(LIMITS.textMaxLength);
    expect(schema.$defs.pet.properties.cooldowns.maxProperties).toBe(LIMITS.cooldownsMaxEntries);
    expect(schema.$defs.albumEntry.properties.id.maxLength).toBe(LIMITS.textMaxLength);
    expect(schema.$defs.albumEntry.properties.name.maxLength).toBe(LIMITS.textMaxLength);
  });

  it("migrate : nom de 40 accepté, 41 refusé, trim pris en compte, points de code comptés", () => {
    expect(code(() => migrate(withPet({ name: name40 })))).toBeNull();
    expect(code(() => migrate(withPet({ name: ` ${name40} ` })))).toBeNull();
    expect(code(() => migrate(withPet({ name: name40 + "N" })))).toBe("invalid");
    expect(code(() => migrate(withPet({ name: "🌟".repeat(40) })))).toBeNull();
    expect(code(() => migrate(withPet({ name: "🌟".repeat(41) })))).toBe("invalid");
    expect(code(() => migrate(withPet({ name: " ".repeat(200) + "a" })))).toBe("invalid");
  });

  it("migrate : identifiants et clés de cooldowns", () => {
    expect(code(() => migrate(withPet({ id: "i".repeat(128) })))).toBeNull();
    expect(code(() => migrate(withPet({ id: "i".repeat(129) })))).toBe("invalid");
    expect(code(() => migrate(withPet({ cooldowns: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, 0])) })))).toBeNull();
    expect(code(() => migrate(withPet({ cooldowns: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 0])) })))).toBe("invalid");
    expect(code(() => migrate(withPet({ cooldowns: { ["k".repeat(129)]: 0 } })))).toBe("invalid");
  });

  const entry = (i: number) => ({ id: `a${i}`, name: `E${i}`, bornAt: i, flownAt: i + 1, stage: "egg", kind: "kawaii" });
  it("migrate : album de 1000 accepté, de 1001 refusé ; entrée trop longue refusée", () => {
    const ok = raw();
    ok["album"] = Array.from({ length: 1000 }, (_, i) => entry(i));
    expect(migrate(ok).album).toHaveLength(1000);
    const big = raw();
    big["album"] = Array.from({ length: 1001 }, (_, i) => entry(i));
    expect(code(() => migrate(big))).toBe("invalid");
    const longName = raw();
    longName["album"] = [{ ...entry(0), name: "N".repeat(41) }];
    expect(code(() => migrate(longName))).toBe("invalid");
    const longId = raw();
    longId["album"] = [{ ...entry(0), id: "i".repeat(129) }];
    expect(code(() => migrate(longId))).toBe("invalid");
  });

  it("createSave : nom ou identifiant trop long -> InvalidIdentityError ; limite exacte acceptée", () => {
    const t = { nowMs: T0, utcOffsetMin: 0 };
    expect(() => createSave({ id: ID, name: name40, seed: 1 }, t, B)).not.toThrow();
    expect(() => createSave({ id: ID, name: ` ${name40} `, seed: 1 }, t, B)).not.toThrow();
    expect(() => createSave({ id: ID, name: name40 + "N", seed: 1 }, t, B)).toThrow(InvalidIdentityError);
    expect(() => createSave({ id: "i".repeat(129), name: "Lumi", seed: 1 }, t, B)).toThrow(InvalidIdentityError);
  });

  const flownWithAlbum = (n: number): SaveState => {
    const s = fresh(NEVER, { pet: { life: "flown", flownAt: T0, gauges: { health: 0 } } });
    s.album = Array.from({ length: n }, (_, i) => entry(i) as SaveState["album"][number]);
    return s;
  };
  it("rebirth : nom de 41 ou id de 129 -> invalidIdentity ; nom de 40 accepté", () => {
    const s = flownWithAlbum(0);
    const refuse = (a: Action) => reduce(s, a, at(0), B).events;
    expect(refuse({ type: "rebirth", id: "n", name: name40 + "N", seed: 1 })).toEqual([{ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" }]);
    expect(refuse({ type: "rebirth", id: "i".repeat(129), name: "N", seed: 1 })).toEqual([{ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" }]);
    expect(refuse({ type: "rebirth", id: "n", name: name40, seed: 1 })).toEqual([{ type: "reborn" }]);
  });

  it("rebirth sur album plein : l'entrée la plus ancienne est retirée, l'album reste à 1000", () => {
    const s = flownWithAlbum(1000);
    const r = reduce(s, { type: "rebirth", id: "n", name: "Nova", seed: 1 }, at(0), B);
    expect(r.events).toEqual([{ type: "reborn" }]);
    expect(r.state.album).toHaveLength(1000);
    expect(r.state.album[0]?.id).toBe("a1");
    expect(r.state.album[999]?.id).toBe(ID);
    // 999 entrées : rien n'est retiré
    const r2 = reduce(flownWithAlbum(999), { type: "rebirth", id: "n", name: "Nova", seed: 1 }, at(0), B);
    expect(r2.state.album).toHaveLength(1000);
    expect(r2.state.album[0]?.id).toBe("a0");
  });

  it("un album importé déjà hors limite (état construit à la main) est ramené à la limite par rebirth", () => {
    const r = reduce(flownWithAlbum(1005), { type: "rebirth", id: "n", name: "Nova", seed: 1 }, at(0), B);
    expect(r.state.album).toHaveLength(1000);
  });
});
