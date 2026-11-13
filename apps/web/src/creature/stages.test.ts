// Parties et poses par espèce x stade, œuf commun, éclosion (handoff), gabarit {kind} et zones de geste par stade.
import { describe, expect, it } from "vitest";
import { defaultBalance } from "@tamagoshi/rules";
import type { Kind, Stage } from "@tamagoshi/rules";
import { KINDS, allPosesOf, eggPoses, particles, posesFor, reactions, svgInner } from "./data";
import { SOON_FROM, eggState, hatchProgress } from "./egg";
import { GEOMETRY, geometryFor, insideBody, setDisplayedStage } from "./geometry";
import { composeEgg, composeStage, layerParts, resolvePreset } from "./parts";
import { resolveTracks } from "./reactions";
import type { PosesSpec } from "./types";

const STATES = ["happy", "hungry", "tired", "sick", "asleep", "dirty", "weak", "flown"] as const;
const GROWN = ["child", "teen", "adult"] as const;

function partsOf(poses: PosesSpec, state: string): string[] {
  return layerParts(poses, poses.states[state]!).map((p) => p.part);
}

describe("poses par stade", () => {
  it("posesFor choisit le jeu de poses du stade (bébé par défaut) et le garde en mémoire", () => {
    for (const kind of KINDS) {
      expect(posesFor(kind).stage).toBe("baby");
      for (const stage of GROWN) {
        expect(posesFor(kind, stage).stage).toBe(stage);
        expect(posesFor(kind, stage)).toBe(posesFor(kind, stage));
        expect(posesFor(kind, stage).kind).toBe(kind);
      }
    }
    expect(posesFor("kawaii", "teen")).not.toBe(posesFor("feerique", "teen"));
  });
  it("l'œuf est le même pour les deux espèces", () => {
    expect(posesFor("kawaii", "egg")).toBe(eggPoses);
    expect(posesFor("feerique", "egg")).toBe(eggPoses);
  });
  it("un stade ou une espèce inconnus retombent sur le bébé de kawaii (sauvegarde étrangère)", () => {
    expect(posesFor("kawaii", "legend" as Stage)).toBe(posesFor("kawaii"));
    expect(posesFor("nope" as Kind, "adult")).toBe(posesFor("kawaii", "adult"));
  });
  it("composeStage reprend les clés communes de la racine et remplace parts, layers et states", () => {
    const root = { easings: { a: [0, 0, 1, 1] }, parts: { x: 1 }, layers: ["x"], states: { s: 1 }, stages: { t: { parts: { y: 2 }, layers: ["y"], states: { u: 2 } } } };
    const t = composeStage(root as unknown as PosesSpec, "t") as unknown as Record<string, unknown>;
    expect(t["easings"]).toBe(root.easings);
    expect(t["layers"]).toEqual(["y"]);
    expect(t["stages"]).toBeUndefined();
    expect(t["stage"]).toBe("t");
    const baby = composeStage(root as unknown as PosesSpec, "baby") as unknown as Record<string, unknown>;
    expect(baby["layers"]).toEqual(["x"]);
    expect(baby["stages"]).toBeUndefined();
  });
  it("composeEgg ajoute l'œuf aux clés communes d'une espèce", () => {
    const common = { easings: { a: [0, 0, 1, 1] }, parts: { x: 1 }, layers: ["x"], states: {}, stages: {} } as unknown as PosesSpec;
    const egg = composeEgg(common, { parts: { e: { origin: [0, 0], variants: {} } }, layers: ["e"], states: {} });
    expect(egg.easings).toBe(common.easings);
    expect(egg.layers).toEqual(["e"]);
    expect(egg.stages).toBeUndefined();
  });
  it("les courbes, emblèmes et priorités communes sont identiques à tous les stades des deux espèces", () => {
    const base = posesFor("kawaii");
    for (const kind of KINDS)
      for (const p of [...allPosesOf(kind), eggPoses]) {
        expect(p.easings).toEqual(base.easings);
        expect(p.emblems).toEqual(base.emblems);
        expect(p.priority).toEqual(base.priority);
      }
  });
});

describe.each(KINDS)("%s : parties de chaque stade et de chaque état", (kind) => {
  it.each(["baby", ...GROWN] as const)("stade %s : 8 états, fichiers existants, ordre de dessin suivi", (stage) => {
    const poses = posesFor(kind, stage);
    expect(Object.keys(poses.states).sort()).toEqual([...STATES].sort());
    for (const id of STATES) {
      const parts = layerParts(poses, poses.states[id]!);
      expect(parts.length, `${stage}/${id}`).toBeGreaterThan(5);
      for (const p of parts) {
        expect(() => svgInner(p.file), `${stage}/${id}/${p.part}`).not.toThrow();
        const ok = p.file.startsWith("creature/") || p.file.startsWith("emblems/");
        expect(ok, p.file).toBe(true);
      }
      const order = parts.map((p) => poses.layers.indexOf(p.part));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });
});

describe("un élément de plus à chaque stade", () => {
  it("kawaii : oreilles, puis queue (ado), puis ailes (adulte) ; pas d'antennes", () => {
    const names = (s: Stage): string[] => partsOf(posesFor("kawaii", s), "happy");
    for (const s of ["baby", ...GROWN] as const) {
      expect(names(s)).toEqual(expect.arrayContaining(["ear-left", "ear-right", "body", "mouth"]));
      expect(names(s)).not.toContain("antenna-left");
      expect(names(s)).not.toContain("crown");
    }
    expect(names("baby")).not.toContain("tail");
    expect(names("child")).not.toContain("tail");
    expect(names("teen")).toContain("tail");
    expect(names("teen")).not.toContain("wing-left");
    expect(names("adult")).toEqual(expect.arrayContaining(["tail", "wing-left", "wing-right"]));
  });
  it("féérique : antennes et ailes dès le bébé, queue (ado), couronne (adulte) ; pas d'oreilles", () => {
    const names = (s: Stage): string[] => partsOf(posesFor("feerique", s), "happy");
    for (const s of ["baby", ...GROWN] as const) {
      expect(names(s)).toEqual(expect.arrayContaining(["antenna-left", "antenna-right", "wing-left", "wing-right", "core", "body"]));
      expect(names(s)).not.toContain("ear-left");
    }
    expect(names("child")).not.toContain("tail");
    expect(names("teen")).toContain("tail");
    expect(names("teen")).not.toContain("crown");
    expect(names("adult")).toEqual(expect.arrayContaining(["tail", "crown"]));
  });
  it("queue, ailes et couronne ont une version éteinte quand la créature va mal (kawaii : aussi fatiguée)", () => {
    for (const [kind, stage, part, bad] of [
      ["kawaii", "teen", "tail", ["tired", "sick", "weak"]],
      ["kawaii", "adult", "wing-left", ["tired", "sick", "weak"]],
      ["feerique", "teen", "tail", ["sick", "weak"]],
      ["feerique", "adult", "crown", ["sick", "weak"]],
    ] as const) {
      const poses = posesFor(kind, stage);
      for (const id of bad) {
        const v = layerParts(poses, poses.states[id]!).find((p) => p.part === part);
        expect(v?.variant, `${kind}/${stage}/${id}/${part}`).toBe("dim");
      }
      expect(layerParts(poses, poses.states["happy"]!).find((p) => p.part === part)?.variant).not.toBe("dim");
    }
  });
  it("chaque stade d'une espèce a ses propres fichiers de corps", () => {
    for (const kind of KINDS) {
      const bodies = (["baby", ...GROWN] as const).map((s) => layerParts(posesFor(kind, s), posesFor(kind, s).states["happy"]!).find((p) => p.part === "body")!.file);
      expect(new Set(bodies).size).toBe(4);
    }
  });
});

describe("œuf commun et éclosion", () => {
  it("trois états : idle, soon (fissures dorées) et hatch (3 s)", () => {
    expect(Object.keys(eggPoses.states).sort()).toEqual(["hatch", "idle", "soon"]);
    expect(partsOf(eggPoses, "idle")).not.toContain("cracks-1");
    expect(partsOf(eggPoses, "soon")).toEqual(expect.arrayContaining(["cracks-1", "cracks-2"]));
    expect(eggPoses.states["hatch"]!.sequence?.duration).toBe(3000);
  });
  it("tous les fichiers de l'œuf existent, dans assets/creature/egg", () => {
    for (const id of ["idle", "soon", "hatch"]) {
      for (const p of layerParts(eggPoses, eggPoses.states[id]!)) {
        expect(p.file.startsWith("creature/egg/"), p.file).toBe(true);
        expect(() => svgInner(p.file)).not.toThrow();
      }
    }
  });
  it("handoff : le bébé apparaît à 60 % de la séquence, avant la fin", () => {
    const hatch = eggPoses.states["hatch"]!;
    expect(hatch.handoff).toMatchObject({ at: 0.6, reveal: "baby" });
    expect(hatch.handoff!.at).toBeGreaterThan(0);
    expect(hatch.handoff!.at).toBeLessThan(1);
    expect(hatch.sequence?.reducedAt).toBe(1);
  });
  it("le gabarit {kind} du préréglage d'éclosion se résout en un préréglage existant pour chaque espèce", () => {
    const ref = eggPoses.states["hatch"]!.particles.find((p) => p.at !== undefined)!;
    expect(ref.preset).toBe("hatch-{kind}");
    for (const kind of KINDS) {
      expect(resolvePreset(ref.preset, kind)).toBe(`hatch-${kind}`);
      expect(particles.presets[resolvePreset(ref.preset, kind)]).toBeDefined();
    }
    expect(resolvePreset("ambient", "kawaii")).toBe("ambient");
  });
  it("les parties de l'œuf ont une origine (rotations et échelles) et les états n'animent que des cibles connues", () => {
    for (const id of ["idle", "soon", "hatch"]) {
      const def = eggPoses.states[id]!;
      const loops = [...def.loops, ...(def.sequence ? [def.sequence] : [])];
      for (const l of loops)
        for (const t of Object.keys(l.targets))
          expect(t in eggPoses.parts || t in eggPoses.targets, `${id}/${t}`).toBe(true);
    }
  });
  it("soon à partir de 60 % de la durée de l'œuf (0,05 h dans l'équilibrage), idle avant ou sans information", () => {
    const born = 1_000_000;
    const duration = 0.05 * 3_600_000;
    expect(hatchProgress(born, defaultBalance, born)).toBe(0);
    expect(hatchProgress(born, defaultBalance, born + duration / 2)).toBeCloseTo(0.5, 5);
    expect(hatchProgress(born, defaultBalance, born + 2 * duration)).toBe(1);
    expect(hatchProgress(born, defaultBalance, born - 5000)).toBe(0);
    expect(eggState(undefined)).toBe("idle");
    expect(eggState(0)).toBe("idle");
    expect(eggState(SOON_FROM - 0.01)).toBe("idle");
    expect(eggState(SOON_FROM)).toBe("soon");
    expect(eggState(1)).toBe("soon");
    expect(eggState(hatchProgress(born, defaultBalance, born + duration * 0.7))).toBe("soon");
  });
  it("sans stade suivant ou durée nulle dans l'équilibrage, l'œuf est considéré à terme", () => {
    expect(hatchProgress(0, { stages: [{ id: "egg", minAgeHours: 0 }] }, 10)).toBe(1);
    expect(hatchProgress(0, { stages: [{ id: "egg", minAgeHours: 1 }, { id: "baby", minAgeHours: 1 }] }, 10)).toBe(1);
    expect(hatchProgress(0, { stages: [] }, 10)).toBe(1);
  });
});

describe("réactions sur chaque stade", () => {
  const groups = reactions.groups;
  it("caresse, touche, réveil, repas : chaque cible résolue existe à au moins un stade de l'espèce, jamais deux fois", () => {
    for (const kind of KINDS) {
      const all = allPosesOf(kind);
      for (const id of ["pet", "tap", "wake", "feed-meal"]) {
        const targets = resolveTracks(reactions.reactions[id]!.tracks, groups, kind).map((t) => t.target);
        expect(new Set(targets).size, `${kind}/${id}`).toBe(targets.length);
        for (const t of targets) {
          const known = all.some((p) => t in p.parts || t in p.targets) || t in reactions.targets || t in reactions.props;
          expect(known, `${kind}/${id}/${t}`).toBe(true);
        }
      }
    }
  });
  it("les ailes de l'adulte kawaii, la queue (deux espèces) et la couronne (féérique) réagissent", () => {
    const pet = reactions.reactions["pet"]!.tracks;
    const names = (kind: Kind): string[] => resolveTracks(pet, groups, kind).map((t) => t.target);
    expect(names("kawaii")).toEqual(expect.arrayContaining(["wing-left", "wing-right", "tail"]));
    expect(names("kawaii")).not.toContain("crown");
    expect(names("feerique")).toEqual(expect.arrayContaining(["wing-left", "tail", "crown", "core"]));
  });
  it("la queue et la couronne se visent par un groupe commun, jamais par un nom de partie", () => {
    for (const r of Object.values(reactions.reactions)) {
      expect("tail" in r.tracks).toBe(false);
      expect("crown" in r.tracks).toBe(false);
    }
    expect(groups["tail-wag"]?.additive).toBe(true);
    expect(groups["crown-glow"]?.additive).toBe(true);
  });
  it("le groupe de la queue est de rotation seule, celui de la couronne d'échelle seule (écarts additifs)", () => {
    for (const r of Object.values(reactions.reactions)) {
      for (const k of r.tracks["tail-wag"] ?? []) expect(Object.keys(k).every((x) => ["offset", "rotate", "easing"].includes(x))).toBe(true);
      for (const k of r.tracks["crown-glow"] ?? []) expect(Object.keys(k).every((x) => ["offset", "scale", "easing"].includes(x))).toBe(true);
    }
  });
});

describe("zones de geste par stade", () => {
  it("sans stade explicite, celui de la créature affichée ; le bébé et l'œuf gardent les zones du bébé", () => {
    expect(geometryFor("kawaii")).toBe(GEOMETRY.kawaii);
    expect(geometryFor("feerique", "egg")).toBe(GEOMETRY.feerique);
    expect(geometryFor("feerique", "baby")).toBe(GEOMETRY.feerique);
    setDisplayedStage("adult");
    try {
      expect(geometryFor("feerique")).toBe(geometryFor("feerique", "adult"));
      expect(geometryFor("feerique").head.y).toBeLessThan(GEOMETRY.feerique.head.y);
    } finally {
      setDisplayedStage("baby");
    }
  });
  it.each(KINDS)("%s : la bouche, la tête et les yeux sont dans le corps à chaque stade", (kind) => {
    for (const stage of GROWN) {
      const g = geometryFor(kind, stage);
      expect(insideBody(g.mouth, kind, stage), `${stage} bouche`).toBe(true);
      expect(insideBody(g.head, kind, stage), `${stage} tête`).toBe(true);
      expect(insideBody({ x: 120, y: g.eyeY }, kind, stage), `${stage} yeux`).toBe(true);
    }
  });
  it("kawaii grossit (le corps de l'adulte est plus large et plus haut), féérique monte (tête et visage plus haut)", () => {
    const wide = (kind: Kind, stage: Stage): number => geometryFor(kind, stage).halfWidthAt(140) ?? 0;
    expect(wide("kawaii", "child")).toBeGreaterThan(wide("kawaii", "baby"));
    expect(wide("kawaii", "adult")).toBeGreaterThan(wide("kawaii", "teen"));
    expect(geometryFor("kawaii", "adult").head.y).toBeLessThan(geometryFor("kawaii", "baby").head.y);
    const heads = (["baby", ...GROWN] as const).map((s) => geometryFor("feerique", s).head.y);
    expect([...heads].sort((a, b) => b - a)).toEqual(heads);
    const mouths = (["baby", ...GROWN] as const).map((s) => geometryFor("feerique", s).mouth.y);
    expect([...mouths].sort((a, b) => b - a)).toEqual(mouths);
  });
  it("la bouche suit celle des parties dessinées (origine de `mouth` des poses du stade, féérique)", () => {
    for (const stage of GROWN) {
      const origin = posesFor("feerique", stage).parts["mouth"]!.origin;
      expect(geometryFor("feerique", stage).mouth.y).toBeCloseTo(origin[1], 0);
      const eye = posesFor("feerique", stage).parts["eye-left"]!.origin;
      expect(geometryFor("feerique", stage).eyeY).toBeCloseTo(eye[1], 0);
    }
  });
});
