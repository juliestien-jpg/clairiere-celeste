import { describe, expect, it } from "vitest";
import { KINDS, posesByKind, posesFor } from "./data";
import { buildKeyframes, easingString, transformString } from "./motion";
import { prefixIds } from "./svgParts";

describe("transformString", () => {
  it("compose translate, rotate puis scale", () => {
    expect(transformString({ translate: [1, 2], rotate: 3, scale: [4, 5] })).toBe(
      "translate(1px, 2px) rotate(3deg) scale(4, 5)",
    );
  });
  it("prend l'identité par défaut et accepte une échelle unique", () => {
    expect(transformString(undefined)).toBe("translate(0px, 0px) rotate(0deg) scale(1, 1)");
    expect(transformString({ scale: 2 })).toContain("scale(2, 2)");
  });
});

describe("buildKeyframes", () => {
  const poses = posesFor("kawaii");
  const loop = poses.states["tired"]!.loops[0]!;
  it("reprend la pose statique pour les propriétés absentes", () => {
    const base = { rotate: -46 };
    const kf = buildKeyframes(loop, [{ offset: 0, scale: [1, 1] }, { offset: 1, scale: [1, 1] }], base, poses.easings);
    expect(kf[0]?.transform).toBe("translate(0px, 0px) rotate(-46deg) scale(1, 1)");
    expect(kf[0]?.opacity).toBeUndefined();
  });
  it("fixe l'opacité partout dès qu'une image clé la fixe", () => {
    const kf = buildKeyframes(loop, [{ offset: 0, opacity: 0.2 }, { offset: 1 }], { opacity: 0.6 }, poses.easings);
    expect(kf.map((k) => k.opacity)).toEqual([0.2, 0.6]);
  });
  it("utilise la courbe de l'image clé, sinon celle de la boucle", () => {
    const kf = buildKeyframes(loop, [{ offset: 0, easing: "linear" }, { offset: 1 }], {}, poses.easings);
    expect(kf[0]?.easing).toBe(easingString(poses.easings, "linear"));
    expect(kf[1]?.easing).toBe(easingString(poses.easings, loop.easing));
  });
});

describe.each(KINDS)("données de poses (%s)", (kind) => {
  const poses = posesFor(kind);
  it("chaque état de deriveView a ses poses, parties et emblème", () => {
    for (const id of ["happy", "hungry", "tired", "sick", "asleep", "dirty", "weak", "flown"]) {
      const s = poses.states[id];
      expect(s, id).toBeDefined();
      for (const part of s!.visible) expect(poses.parts[part], `${id}/${part}`).toBeDefined();
      if (s!.emblem) expect(poses.emblems[s!.emblem], `${id} emblème`).toBeDefined();
    }
  });
  it("les vocabulaires restent réduits : seules transform et opacity sont animées", () => {
    const allowed = new Set(["offset", "translate", "rotate", "scale", "opacity", "easing"]);
    for (const s of Object.values(poses.states)) {
      for (const loop of [...s.loops, ...(s.sequence ? [s.sequence] : []), ...(s.after?.loops ?? [])]) {
        for (const frames of Object.values(loop.targets)) {
          for (const f of frames) for (const k of Object.keys(f)) expect(allowed.has(k), k).toBe(true);
        }
      }
    }
  });
  it("les boucles et poses ne visent que des cibles connues de l'espèce", () => {
    const known = (n: string): boolean => n in poses.parts || n in poses.targets;
    for (const [id, s] of Object.entries(poses.states)) {
      for (const n of Object.keys(s.static)) expect(known(n), `${id} static ${n}`).toBe(true);
      for (const loop of [...s.loops, ...(s.sequence ? [s.sequence] : []), ...(s.after?.loops ?? [])])
        for (const n of Object.keys(loop.targets)) expect(known(n), `${id}/${loop.id} ${n}`).toBe(true);
    }
  });
});

describe("poses des deux espèces", () => {
  it("partagent les courbes, les emblèmes et les 8 états (seules les parties diffèrent)", () => {
    const [a, b] = [posesByKind.kawaii, posesByKind.feerique];
    expect(Object.keys(a.states).sort()).toEqual(Object.keys(b.states).sort());
    expect(a.easings).toEqual(b.easings);
    expect(a.emblems).toEqual(b.emblems);
    expect(a.transition).toEqual(b.transition);
    expect(a.priority).toEqual(b.priority);
  });
});

describe("prefixIds", () => {
  it("préfixe les identifiants et leurs références", () => {
    const out = prefixIds('<radialGradient id="a"/><circle fill="url(#a)"/>', "p");
    expect(out).toBe('<radialGradient id="p-a"/><circle fill="url(#p-a)"/>');
  });
});
