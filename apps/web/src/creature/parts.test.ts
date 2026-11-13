import { describe, expect, it } from "vitest";
import { KINDS, posesByKind, posesFor, svgInner } from "./data";
import { layerParts } from "./parts";

const STATES = ["happy", "hungry", "tired", "sick", "asleep", "dirty", "weak", "flown"] as const;
type Kind = "kawaii" | "feerique";

describe("parties et poses par espèce (D6)", () => {
  it("posesFor rend les poses de l'espèce demandée", () => {
    expect(posesFor("kawaii")).toBe(posesByKind.kawaii);
    expect(posesFor("feerique")).toBe(posesByKind.feerique);
    expect(posesFor("kawaii")).not.toBe(posesFor("feerique"));
    expect(posesFor("kawaii").kind).toBe("kawaii");
    expect(posesFor("feerique").kind).toBe("feerique");
  });

  it.each(KINDS)("%s : chaque état se compose de fichiers existants rangés dans l'espèce (ou partagés)", (kind) => {
    const poses = posesFor(kind);
    for (const id of STATES) {
      const parts = layerParts(poses, poses.states[id]!);
      expect(parts.length, id).toBeGreaterThan(5);
      for (const p of parts) {
        expect(() => svgInner(p.file), `${kind}/${id}/${p.part}`).not.toThrow();
        const ok = p.file.startsWith(`creature/${kind}/`) || p.file.startsWith("emblems/");
        expect(ok, `${kind}/${id}/${p.part} : ${p.file}`).toBe(true);
      }
    }
  });

  it("kawaii dessine des oreilles, féérique des antennes, des ailes et une étoile de poitrine", () => {
    const names = (kind: Kind): string[] => layerParts(posesFor(kind), posesFor(kind).states["happy"]!).map((p) => p.part);
    const k = names("kawaii");
    const f = names("feerique");
    expect(k).toEqual(expect.arrayContaining(["ear-left", "ear-right", "body", "mouth"]));
    for (const absent of ["antenna-left", "antenna-right", "wing-left", "wing-right", "core", "trail"]) expect(k).not.toContain(absent);
    expect(f).toEqual(expect.arrayContaining(["antenna-left", "antenna-right", "wing-left", "wing-right", "core", "trail", "body"]));
    expect(f).not.toContain("ear-left");
    expect(f).not.toContain("ear-right");
  });

  it("l'ordre de dessin suit `layers` et les variantes de l'état sont appliquées", () => {
    const poses = posesFor("feerique");
    const hungry = layerParts(poses, poses.states["hungry"]!);
    const order = hungry.map((p) => poses.layers.indexOf(p.part));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(hungry.find((p) => p.part === "mouth")?.variant).toBe("o");
    expect(hungry.find((p) => p.part === "core")?.variant).toBe("hungry");
    expect(hungry.some((p) => p.part === "hand")).toBe(true);
  });

  it("les deux espèces n'ont aucun fichier de partie en commun (sauf les emblèmes)", () => {
    const files = (kind: Kind): Set<string> => {
      const s = new Set<string>();
      for (const id of STATES) for (const p of layerParts(posesFor(kind), posesFor(kind).states[id]!)) s.add(p.file);
      return s;
    };
    const f = files("feerique");
    for (const file of files("kawaii")) if (!file.startsWith("emblems/")) expect(f.has(file), file).toBe(false);
  });

  it("féérique : l'état affaibli garde ses lucioles continues (préréglage ambient, 40 particules au plus)", () => {
    const weak = posesFor("feerique").states["weak"]!;
    expect(weak.particles.map((p) => p.preset)).toEqual(["ambient"]);
    expect(weak.particles[0]?.continuous).toBe(true);
  });
});
