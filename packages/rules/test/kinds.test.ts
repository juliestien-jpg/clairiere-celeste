// Espèces (D6) : tirage à la naissance et à la renaissance, forçage, album, balance, migration v1 -> v2.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBalance,
  BalanceError,
  createSave,
  defaultBalance as B,
  deriveView,
  InvalidKindError,
  KINDS,
  migrate,
  MigrationError,
  nextRandom,
  reduce,
  SAVE_VERSION,
} from "../src/index";
import type { Balance, Kind, SaveState } from "../src/index";
import { validate } from "./json-schema";
import { at, clone, deepFreeze, fresh, H, ID, NEVER, T0 } from "./qa-helpers";
import { mergePatch } from "./scenario-runner";

const time = { nowMs: T0, utcOffsetMin: 0 };
const withKinds = (kinds: unknown): Balance => ({ ...clone(B), kinds }) as Balance;
const born = (seed: number, balance: Balance = B): SaveState => createSave({ id: ID, name: "x", seed }, time, balance);
const saveSchema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../spec/save.schema.json", import.meta.url)), "utf8")) as Record<string, unknown>;

function countKinds(balance: Balance, n: number): Record<Kind, number> {
  const c: Record<Kind, number> = { kawaii: 0, feerique: 0 };
  for (let seed = 1; seed <= n; seed++) c[born(seed, balance).pet.kind]++;
  return c;
}

describe("tirage de l'espèce à la naissance", () => {
  it("la balance par défaut tire kawaii et feerique à parts égales", () => {
    expect(B.kinds).toEqual([
      { id: "kawaii", weight: 1 },
      { id: "feerique", weight: 1 },
    ]);
  });

  it("poids par défaut : proche de 50/50 sur 4000 graines", () => {
    const c = countKinds(B, 4000);
    expect(c.kawaii + c.feerique).toBe(4000);
    expect(c.kawaii).toBeGreaterThan(1800);
    expect(c.kawaii).toBeLessThan(2200);
  });

  it("poids 3/1 respectés (feerique 3, kawaii 1) : environ 75 % / 25 %", () => {
    const c = countKinds(withKinds([{ id: "feerique", weight: 3 }, { id: "kawaii", weight: 1 }]), 4000);
    expect(c.feerique).toBeGreaterThan(2800);
    expect(c.feerique).toBeLessThan(3200);
  });

  it("l'ordre du tableau est significatif : même graine, ordre inversé, espèce inversée", () => {
    const a = withKinds([{ id: "kawaii", weight: 1 }, { id: "feerique", weight: 1 }]);
    const b = withKinds([{ id: "feerique", weight: 1 }, { id: "kawaii", weight: 1 }]);
    for (const seed of [1, 7, 99, 12345]) expect(born(seed, a).pet.kind).not.toBe(born(seed, b).pet.kind);
  });

  it("une seule espèce dans le tableau : toujours celle-là", () => {
    for (let seed = 1; seed <= 50; seed++) expect(born(seed, withKinds([{ id: "feerique", weight: 5 }])).pet.kind).toBe("feerique");
  });

  it("règle exacte : un tirage mulberry32 depuis la graine, pick = floor(valeur * somme des poids)", () => {
    for (const seed of [0, 1, 7, 99, 12345, 4294967295]) {
      const { value, state } = nextRandom(seed >>> 0);
      const s = born(seed);
      expect(s.pet.kind).toBe(Math.floor(value * 2) < 1 ? "kawaii" : "feerique");
      expect(s.pet.rng).toBe(state); // exactement un tirage consommé
    }
  });

  it("déterministe : même graine, même espèce et même état", () => {
    expect(born(31337)).toEqual(born(31337));
  });

  it("vecteurs : seed 7 -> kawaii, seed 1 -> feerique", () => {
    expect(born(7).pet.kind).toBe("kawaii");
    expect(born(1).pet.kind).toBe("feerique");
  });
});

describe("espèce forcée", () => {
  it("createSave : kind forcé, aucun tirage (rng = graine)", () => {
    for (const kind of KINDS) {
      const s = createSave({ id: ID, name: "x", seed: 1, kind }, time, B);
      expect(s.pet.kind).toBe(kind);
      expect(s.pet.rng).toBe(1);
    }
  });

  it("createSave : kind inconnu -> InvalidKindError", () => {
    for (const kind of ["dragon", "", null, 3, "Kawaii"]) {
      expect(() => createSave({ id: ID, name: "x", seed: 1, kind: kind as never }, time, B)).toThrow(InvalidKindError);
    }
  });

  it("rebirth : kind forcé sans tirage ; kind invalide -> invalidIdentity, état inchangé", () => {
    const flown = fresh(NEVER, { pet: { life: "flown", flownAt: T0, lastUpdatedAt: T0 } });
    const ok = reduce(flown, { type: "rebirth", id: "n", name: "Nova", seed: 5, kind: "feerique" }, at(H), B);
    expect(ok.events).toEqual([{ type: "reborn" }]);
    expect(ok.state.pet.kind).toBe("feerique");
    expect(ok.state.pet.rng).toBe(5);
    for (const kind of ["dragon", null, "", 1]) {
      const r = reduce(flown, { type: "rebirth", id: "n", name: "Nova", seed: 5, kind } as never, at(H), B);
      expect(r.events).toEqual([{ type: "actionRefused", action: "rebirth", reason: "invalidIdentity" }]);
      expect(r.state.pet.life).toBe("flown");
      expect(r.state.album).toEqual([]);
    }
  });

  it("rebirth sans kind : tirage depuis la graine de la nouvelle vie (pas l'ancien rng)", () => {
    const flown = fresh(NEVER, { pet: { life: "flown", flownAt: T0, lastUpdatedAt: T0, rng: 424242 } });
    const r = reduce(flown, { type: "rebirth", id: "n", name: "Nova", seed: 7 }, at(H), B).state;
    expect(r.pet.kind).toBe(born(7).pet.kind);
    expect(r.pet.rng).toBe(born(7).pet.rng);
  });
});

describe("album et vue", () => {
  it("l'album garde l'espèce de chaque créature envolée, dans l'ordre", () => {
    let s = fresh(NEVER, { pet: { kind: "feerique", life: "flown", flownAt: T0, lastUpdatedAt: T0 } });
    s = reduce(s, { type: "rebirth", id: "b", name: "B", seed: 1, kind: "kawaii" }, at(H), B).state;
    s = mergePatch(s, { pet: { life: "flown", flownAt: T0 + 2 * H, lastUpdatedAt: T0 + 2 * H } }) as SaveState;
    s = reduce(s, { type: "rebirth", id: "c", name: "C", seed: 2, kind: "feerique" }, at(3 * H), B).state;
    expect(s.album.map((e) => [e.name, e.kind])).toEqual([
      ["Lumi", "feerique"],
      ["B", "kawaii"],
    ]);
    expect(s.pet.kind).toBe("feerique");
    expect(validate(saveSchema, s)).toEqual([]);
  });

  it("reduce conserve pet.kind et ne mute pas l'entrée", () => {
    const s = deepFreeze(fresh(NEVER, { pet: { kind: "feerique" } }));
    expect(reduce(s, { type: "tick" }, at(10 * H), B).state.pet.kind).toBe("feerique");
  });

  it("deriveView expose kind (vivant ou envolé)", () => {
    expect(deriveView(fresh(NEVER, { pet: { kind: "feerique" } }), at(0), B).kind).toBe("feerique");
    expect(deriveView(fresh(NEVER, { pet: { kind: "kawaii" } }), at(0), B).kind).toBe("kawaii");
    const flown = fresh(NEVER, { pet: { kind: "feerique", life: "flown", flownAt: T0, lastUpdatedAt: T0 } });
    expect(deriveView(flown, at(H), B)).toMatchObject({ kind: "feerique", primary: "flown" });
  });

  it("createSave respecte save.schema.json (version 2)", () => {
    const s = born(3);
    expect(s.version).toBe(2);
    expect(SAVE_VERSION).toBe(2);
    expect(validate(saveSchema, s)).toEqual([]);
    const bad = clone(s) as unknown as { pet: Record<string, unknown> };
    delete bad.pet["kind"];
    expect(validate(saveSchema, bad).length).toBeGreaterThan(0);
    bad.pet["kind"] = "dragon";
    expect(validate(saveSchema, bad).length).toBeGreaterThan(0);
  });
});

describe("validation du bloc kinds de la balance", () => {
  const bads: [string, unknown][] = [
    ["absent", undefined],
    ["vide", []],
    ["pas un tableau", { kawaii: 1 }],
    ["poids non entier", [{ id: "kawaii", weight: 1.5 }]],
    ["poids 0", [{ id: "kawaii", weight: 0 }]],
    ["poids négatif", [{ id: "kawaii", weight: -1 }]],
    ["poids NaN", [{ id: "kawaii", weight: Number.NaN }]],
    ["poids texte", [{ id: "kawaii", weight: "1" }]],
    ["id inconnu", [{ id: "dragon", weight: 1 }]],
    ["id dupliqué", [{ id: "kawaii", weight: 1 }, { id: "kawaii", weight: 2 }]],
    ["entrée non objet", [null]],
    ["somme trop grande", [{ id: "kawaii", weight: 1000000 }, { id: "feerique", weight: 1 }]],
  ];
  for (const [name, kinds] of bads) {
    it(`BalanceError : ${name}`, () => {
      const b = withKinds(kinds);
      expect(() => assertBalance(b)).toThrow(BalanceError);
      expect(() => createSave({ id: ID, name: "x", seed: 1 }, time, b)).toThrow(BalanceError);
      expect(() => migrate(fresh(), b)).toThrow(BalanceError);
    });
  }
});

describe("migration v1 -> v2", () => {
  const v1 = (): Record<string, unknown> => {
    const album = [
      { id: "a", name: "A", bornAt: 1, flownAt: 2, stage: "adult", kind: "kawaii" },
      { id: "b", name: "B", bornAt: 3, flownAt: 4, stage: "child", kind: "kawaii" },
    ];
    const raw = clone(fresh(NEVER, { album })) as unknown as Record<string, Record<string, unknown>>;
    raw["version"] = 1 as never;
    delete raw["pet"]?.["kind"];
    for (const e of raw["album"] as unknown as Record<string, unknown>[]) delete e["kind"];
    return raw as Record<string, unknown>;
  };

  it("pet.kind et chaque album[].kind deviennent kawaii, le reste est conservé", () => {
    const s = migrate(v1());
    expect(s.version).toBe(2);
    expect(s.pet.kind).toBe("kawaii");
    expect(s.album.map((e) => e.kind)).toEqual(["kawaii", "kawaii"]);
    expect(s.album.map((e) => e.name)).toEqual(["A", "B"]);
    expect(s.pet.rng).toBe(NEVER);
    expect(validate(saveSchema, s)).toEqual([]);
  });

  it("ne mute pas l'entrée (gelée en profondeur) et renvoie des copies", () => {
    const raw = deepFreeze(v1());
    const before = JSON.stringify(raw);
    const s = migrate(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(s.pet).not.toBe(raw["pet"]);
    expect(Object.keys(raw["pet"] as object)).not.toContain("kind");
  });

  it("v1 mal formée : MigrationError invalid, jamais autre chose", () => {
    for (const patch of [{ pet: null }, { album: [1] }, { album: null }, { pet: [] }]) {
      const raw = { ...v1(), ...patch };
      expect(() => migrate(raw)).toThrow(MigrationError);
      try {
        migrate(raw);
      } catch (e) {
        expect((e as MigrationError).code).toBe("invalid");
      }
    }
  });

  it("v2 valide : l'espèce feerique est conservée", () => {
    const album = [{ id: "a", name: "A", bornAt: 1, flownAt: 2, stage: "adult", kind: "feerique" }];
    const m = migrate(clone(fresh(NEVER, { pet: { kind: "feerique" }, album })));
    expect(m.pet.kind).toBe("feerique");
    expect(m.album[0]?.kind).toBe("feerique");
  });

  it("v2 sans kind valide : refus (invalid), pas de valeur par défaut", () => {
    const code = (raw: unknown): string => {
      try {
        migrate(raw);
        return "ok";
      } catch (e) {
        return (e as MigrationError).code;
      }
    };
    const album = [{ id: "a", name: "A", bornAt: 1, flownAt: 2, stage: "adult", kind: "kawaii" }];
    const base = clone(fresh(NEVER, { album })) as unknown as { pet: Record<string, unknown>; album: Record<string, unknown>[] };
    expect(code(base)).toBe("ok");
    const noPet = clone(base);
    delete noPet.pet["kind"];
    expect(code(noPet)).toBe("invalid");
    const noAlbum = clone(base);
    delete noAlbum.album[0]?.["kind"];
    expect(code(noAlbum)).toBe("invalid");
    for (const bad of ["dragon", "Kawaii", "", null, 1, undefined]) {
      const p = clone(base);
      p.pet["kind"] = bad;
      expect(code(p), String(bad)).toBe("invalid");
      const a = clone(base);
      if (a.album[0] !== undefined) a.album[0]["kind"] = bad;
      expect(code(a), String(bad)).toBe("invalid");
    }
  });
});
