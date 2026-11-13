import { describe, expect, it } from "vitest";
import { allPosesOf, particles, reactions, svgInner } from "./data";
import {
  hatchReaction,
  planReaction,
  reactionForAction,
  reactionForOutcome,
  resolveTracks,
  validateReactions,
  windowOpacityFrames,
} from "./reactions";

/** Toutes les poses de chaque espèce (bébé, enfant, adolescent, adulte) : une partie vaut dès qu'un stade la dessine. */
const posesByKind = { kawaii: allPosesOf("kawaii"), feerique: allPosesOf("feerique") };

function fileExists(file: string): boolean {
  try {
    return svgInner(file).length > 0;
  } catch {
    return false;
  }
}

describe("reactions.json", () => {
  it("est cohérent avec les poses des deux espèces, particles.json et les accessoires", () => {
    expect(validateReactions(reactions, posesByKind, particles, fileExists)).toEqual([]);
  });
  it("garde chaque réaction entre 600 et 1 200 ms", () => {
    for (const [id, r] of Object.entries(reactions.reactions)) {
      expect(r.duration, id).toBeGreaterThanOrEqual(600);
      expect(r.duration, id).toBeLessThanOrEqual(1200);
    }
  });
  it("n'emploie que translate, rotate, scale et opacity", () => {
    const allowed = new Set(["offset", "translate", "rotate", "scale", "opacity", "easing"]);
    for (const r of Object.values(reactions.reactions))
      for (const frames of Object.values(r.tracks))
        for (const k of frames) for (const key of Object.keys(k)) expect(allowed.has(key)).toBe(true);
  });
  it("détecte une cible, une variante ou un préréglage inconnus", () => {
    const bad = structuredClone(reactions);
    bad.reactions["tap"] = {
      ...bad.reactions["tap"]!,
      tracks: { nulle: [{ offset: 0 }, { offset: 1 }] },
      swaps: [{ part: "mouth", variant: "nulle", from: 0, to: 0.5 }],
      particles: [{ preset: "nulle", at: 0.2 }],
    };
    const problems = validateReactions(bad, posesByKind, particles, fileExists);
    expect(problems.some((p) => p.includes("cible inconnue"))).toBe(true);
    expect(problems.some((p) => p.includes("variante inconnue"))).toBe(true);
    expect(problems.some((p) => p.includes("préréglage"))).toBe(true);
  });
  it("détecte des fenêtres d'expression qui se chevauchent et une durée hors limites", () => {
    const bad = structuredClone(reactions);
    bad.reactions["refuse"] = {
      ...bad.reactions["refuse"]!,
      duration: 300,
      swaps: [
        { part: "mouth", variant: "o", from: 0, to: 0.6 },
        { part: "mouth", variant: "smile", from: 0.5, to: 1 },
      ],
    };
    const problems = validateReactions(bad, posesByKind, particles, fileExists);
    expect(problems.some((p) => p.includes("chevauchent"))).toBe(true);
    expect(problems.some((p) => p.includes("durée"))).toBe(true);
  });
  it("ne dépasse pas 40 particules par bouffée", () => {
    for (const r of Object.values(reactions.reactions))
      for (const c of r.particles)
        expect(c.count ?? particles.presets[c.preset]?.count ?? 0).toBeLessThanOrEqual(particles.limits.maxParticles);
  });
});

describe("réaction choisie", () => {
  it("une réaction par action réussie", () => {
    expect(reactionForAction({ type: "feed", food: "meal" })).toBe("feed-meal");
    expect(reactionForAction({ type: "feed", food: "snack" })).toBe("feed-snack");
    expect(reactionForAction({ type: "clean" })).toBe("wash");
    expect(reactionForAction({ type: "heal" })).toBe("heal");
    expect(reactionForAction({ type: "play" })).toBe("play");
    expect(reactionForAction({ type: "pet" })).toBe("pet");
    expect(reactionForAction({ type: "sleep" })).toBe("sleep");
    expect(reactionForAction({ type: "wake" })).toBe("wake");
    expect(reactionForAction({ type: "tick" })).toBeNull();
  });
  it("un refus donne le hochement doux, sauf la caresse qui reste tendre", () => {
    const refused = (action: "feed" | "pet") => [{ type: "actionRefused" as const, action, reason: "notHungry" }];
    expect(reactionForOutcome({ type: "feed", food: "meal" }, refused("feed"))).toBe("refuse");
    expect(reactionForOutcome({ type: "pet" }, refused("pet"))).toBe("pet");
    expect(reactionForOutcome({ type: "clean" }, [])).toBe("wash");
  });
});

describe("plan d'une réaction", () => {
  const meal = reactions.reactions["feed-meal"]!;
  it("regroupe les fenêtres d'une même variante", () => {
    const plan = planReaction(meal, reactions.props, false);
    const mouthO = plan.swaps.find((s) => s.part === "mouth" && s.variant === "o");
    expect(mouthO?.windows.length).toBe(3);
    expect(plan.particles.length).toBeGreaterThan(0);
  });
  it("en mouvement réduit : fondus seulement, une expression tenue par partie, aucune particule", () => {
    const plan = planReaction(meal, reactions.props, true);
    expect(plan.particles).toEqual([]);
    for (const t of plan.tracks)
      for (const k of t.frames) expect(Object.keys(k).every((key) => key === "offset" || key === "opacity")).toBe(true);
    expect(plan.tracks.some((t) => t.target === "touch")).toBe(false);
    expect(plan.tracks.some((t) => t.target === "bowl")).toBe(true);
    const mouth = plan.swaps.filter((s) => s.part === "mouth");
    expect(mouth).toHaveLength(1);
    expect(mouth[0]?.variant).toBe("smile");
  });
  it("passage net d'une expression : opacité 0/1 aux bornes de la fenêtre", () => {
    const f = windowOpacityFrames([[0.2, 0.5]], true);
    expect(f[0]).toEqual({ offset: 0, opacity: 0 });
    expect(f.some((k) => k.opacity === 1)).toBe(true);
    expect(f[f.length - 1]?.opacity).toBe(0);
    for (let i = 1; i < f.length; i++)
      expect((f[i] as { offset: number }).offset).toBeGreaterThan((f[i - 1] as { offset: number }).offset);
    expect(windowOpacityFrames([[0.2, 0.5]], false)[0]?.opacity).toBe(1);
  });
});

describe("cibles communes (D6)", () => {
  const groups = reactions.groups;
  const tips = reactions.reactions["pet"]!.tracks["head-tips"]!;

  it("head-tips vaut les oreilles chez kawaii et les antennes chez féérique", () => {
    const k = resolveTracks({ "head-tips": tips }, groups, "kawaii").map((t) => t.target);
    const f = resolveTracks({ "head-tips": tips }, groups, "feerique").map((t) => t.target);
    expect(k.sort()).toEqual(["ear-left", "ear-right"]);
    expect(f.sort()).toEqual(["antenna-left", "antenna-right"]);
  });
  it("wings : ailes de l'adulte chez kawaii (ignorées aux autres stades), ailes dès le bébé chez féérique ; chest-light n'existe que chez féérique", () => {
    const wings = reactions.reactions["tap"]!.tracks["wings"]!;
    expect(resolveTracks({ wings }, groups, "kawaii").map((t) => t.target).sort()).toEqual(["wing-left", "wing-right"]);
    expect(allPosesOf("kawaii").filter((p) => "wing-left" in p.parts).map((p) => p.stage)).toEqual(["adult"]);
    expect(resolveTracks({ wings }, groups, "feerique").map((t) => t.target).sort()).toEqual(["wing-left", "wing-right"]);
    expect(resolveTracks({ "chest-light": [{ offset: 0 }, { offset: 1 }] }, groups, "kawaii")).toEqual([]);
    expect(resolveTracks({ "chest-light": [{ offset: 0 }, { offset: 1 }] }, groups, "feerique").map((t) => t.target)).toEqual(["core"]);
  });
  it("le côté gauche est le miroir du côté droit (rotation et translation horizontale inversées)", () => {
    const frames = [{ offset: 0 }, { offset: 0.5, rotate: 8, translate: [2, 3] as const, scale: 1.1 }, { offset: 1, rotate: 0 }];
    const [left, right] = resolveTracks({ "head-tips": frames }, groups, "feerique");
    expect(left?.target).toBe("antenna-left");
    expect(right?.target).toBe("antenna-right");
    expect(right?.frames).toEqual(frames);
    expect(left?.frames[1]).toEqual({ offset: 0.5, rotate: -8, translate: [-2, 3], scale: 1.1 });
    expect(left?.frames[2]?.rotate).toBe(0);
    expect(Object.is(left?.frames[2]?.rotate, -0)).toBe(false);
  });
  it("les groupes sont additifs ; les cibles directes ne le sont pas et passent telles quelles", () => {
    const direct = [{ offset: 0 }, { offset: 1 }];
    const out = resolveTracks({ halo: direct, "head-tips": tips }, groups, "kawaii");
    expect(out.find((t) => t.target === "halo")).toEqual({ target: "halo", frames: direct, additive: false });
    expect(out.filter((t) => t.additive).map((t) => t.target).sort()).toEqual(["ear-left", "ear-right"]);
  });
  it("le plan d'une réaction vise les parties de l'espèce affichée", () => {
    const pet = reactions.reactions["pet"]!;
    const targets = (kind: "kawaii" | "feerique"): string[] =>
      planReaction(pet, reactions.props, false, { groups, kind }).tracks.map((t) => t.target);
    expect(targets("kawaii")).toContain("ear-left");
    expect(targets("kawaii")).not.toContain("antenna-left");
    expect(targets("kawaii")).toContain("wing-left"); // ailes de l'adulte ; ignorées par les autres stades (absentes du SVG)
    expect(targets("kawaii")).not.toContain("core");
    expect(targets("feerique")).toEqual(expect.arrayContaining(["antenna-left", "antenna-right", "wing-left", "wing-right", "core"]));
    expect(targets("feerique")).not.toContain("ear-left");
  });
  it("caresser, toucher, réveiller, jouer et attraper animent les antennes et les ailes féériques", () => {
    for (const id of ["pet", "tap", "wake", "play", "catch"]) {
      const plan = planReaction(reactions.reactions[id]!, reactions.props, false, { groups, kind: "feerique" });
      const targets = plan.tracks.map((t) => t.target);
      expect(targets, id).toContain("antenna-left");
      expect(targets, id).toContain("wing-right");
    }
  });
  it("chaque cible résolue existe dans les poses de son espèce", () => {
    for (const kind of ["kawaii", "feerique"] as const) {
      const all = allPosesOf(kind);
      for (const [id, r] of Object.entries(reactions.reactions))
        for (const t of resolveTracks(r.tracks, groups, kind)) {
          const found =
            all.some((poses) => t.target in poses.parts || t.target in poses.targets) ||
            t.target in reactions.targets ||
            t.target in reactions.props;
          expect(found, `${id}/${kind}/${t.target}`).toBe(true);
        }
    }
  });
  it("mouvement réduit : les groupes (écarts sans opacité) disparaissent, plus de rebond", () => {
    const plan = planReaction(reactions.reactions["tap"]!, reactions.props, true, { groups, kind: "feerique" });
    expect(plan.tracks).toEqual([]);
  });
  it("la validation repère un groupe qui vise une partie absente de l'espèce, ou une cible visée deux fois", () => {
    const bad = structuredClone(reactions);
    bad.groups["head-tips"] = { ...bad.groups["head-tips"]!, parts: { kawaii: ["ear-left", "ear-nulle"], feerique: ["antenna-left"] } };
    bad.reactions["tap"] = {
      ...bad.reactions["tap"]!,
      tracks: { ...bad.reactions["tap"]!.tracks, "ear-left": [{ offset: 0 }, { offset: 1 }] },
    };
    const problems = validateReactions(bad, posesByKind, particles, fileExists);
    expect(problems.some((p) => p.includes("ear-nulle"))).toBe(true);
    expect(problems.some((p) => p.includes("paire"))).toBe(true);
    expect(problems.some((p) => p.includes("visée"))).toBe(true);
  });
  it("une réaction d'éclosion par espèce", () => {
    expect(hatchReaction("kawaii")).toBe("hatch-kawaii");
    expect(hatchReaction("feerique")).toBe("hatch-feerique");
    expect(reactions.reactions[hatchReaction("kawaii")]).toBeDefined();
    expect(reactions.reactions[hatchReaction("feerique")]).toBeDefined();
  });
});
