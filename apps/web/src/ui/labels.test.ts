import type { View } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import { KIND_LABEL, describeEvent, pageTitle, refusalText } from "./labels";

const levels = { satiety: "ok", happiness: "ok", energy: "ok", hygiene: "ok", health: "ok" } as const;

describe("labels", () => {
  it("le titre de l'onglet signale un besoin", () => {
    const hungry: View = { kind: "kawaii", primary: "hungry", secondary: [], gaugeLevels: { ...levels } };
    const happy: View = { kind: "kawaii", primary: "happy", secondary: [], gaugeLevels: { ...levels } };
    expect(pageTitle("Lumi", hungry)).toContain("Lumi a faim");
    expect(pageTitle("Lumi", happy)).toBe("Lumi · Clairière céleste");
    expect(pageTitle(null, null)).toBe("Clairière céleste");
  });

  it("chaque raison de refus a un texte doux, avec repli", () => {
    expect(refusalText("cooldown", "Lumi")).toMatch(/Lumi/);
    expect(refusalText("raison-inconnue", "Lumi")).toMatch(/pas possible/);
    expect(refusalText("flownDuringCatchUp", "Lumi")).toMatch(/étoile/);
    expect(refusalText("unknownAction", "Lumi")).toMatch(/compris/);
    expect(refusalText("invalidAction", "Lumi")).toMatch(/compris/);
  });

  it("l'éclosion dit l'espèce découverte, sans la mentionner ailleurs", () => {
    const hatch = { type: "stageChanged", from: "egg", to: "baby" } as const;
    expect(describeEvent(hatch, "Lumi", "feerique")?.text).toMatch(/esprit de lumière/);
    expect(describeEvent(hatch, "Lumi", "kawaii")?.text).toMatch(/tout rond/);
    expect(describeEvent(hatch, "Lumi")?.text).toBe("L'œuf s'est ouvert : Lumi est là !");
    expect(describeEvent({ type: "stageChanged", from: "baby", to: "child" }, "Lumi", "feerique")?.text).toBe("Lumi a grandi.");
    expect(KIND_LABEL).toEqual({ kawaii: "kawaii", feerique: "féérique" });
  });

  it("le nom accessible de l'état ne mentionne pas l'espèce", () => {
    for (const k of ["kawaii", "feerique"] as const) {
      const v: View = { kind: k, primary: "hungry", secondary: [], gaugeLevels: { ...levels } };
      expect(pageTitle("Lumi", v)).toContain("Lumi a faim");
      expect(pageTitle("Lumi", v)).not.toMatch(/féérique|kawaii/i);
    }
  });
});

describe("événement clockAdjusted", () => {
  it("est annoncé par un message doux", () => {
    expect(describeEvent({ type: "clockAdjusted", deltaMs: -3_600_000 }, "Lumi")?.text).toBe(
      "L'horloge de l'appareil a changé : la clairière s'est remise à l'heure.",
    );
  });
});
