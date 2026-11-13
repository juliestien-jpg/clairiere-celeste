import { describe, expect, it } from "vitest";
import { localMinutes, luminance, skyAt } from "./theme";

const at = (h: number, m = 0): number => h * 60 + m;

describe("skyAt", () => {
  it("donne le ciel de la fenêtre, sans fondu hors des frontières", () => {
    expect(skyAt(at(12)).current).toBe("day");
    expect(skyAt(at(12)).neighbor).toBeNull();
    expect(skyAt(at(19, 30)).current).toBe("dusk");
    expect(skyAt(at(2)).current).toBe("night");
    expect(skyAt(at(6, 30)).current).toBe("dawn");
  });

  it("couvre la nuit à cheval sur minuit", () => {
    expect(skyAt(at(23)).current).toBe("night");
    expect(skyAt(at(0)).current).toBe("night");
    expect(skyAt(at(4, 59)).current).toBe("night");
  });

  it("fond pendant 30 minutes centrées sur la frontière (moitié-moitié à la frontière)", () => {
    const start = skyAt(at(8)); // début du jour
    expect(start.current).toBe("day");
    expect(start.neighbor).toBe("dawn");
    expect(start.neighborShare).toBeCloseTo(0.5);
    const before = skyAt(at(7, 50)); // fin de l'aube, 10 min avant
    expect(before.current).toBe("dawn");
    expect(before.neighbor).toBe("day");
    expect(before.neighborShare).toBeCloseTo(0.5 * (1 - 10 / 15));
    expect(skyAt(at(7, 45)).neighborShare).toBeCloseTo(0);
    expect(skyAt(at(8, 15)).neighbor).toBeNull();
  });

  it("mélange les étoiles", () => {
    expect(skyAt(at(1)).stars).toBe(1);
    expect(skyAt(at(12)).stars).toBe(0);
    expect(skyAt(at(21)).stars).toBeCloseTo(0.5 * 0.5 + 0.5 * 1);
  });
});

describe("localMinutes", () => {
  it("applique le décalage local et reste dans la journée", () => {
    expect(localMinutes(0, 60)).toBe(60);
    expect(localMinutes(0, -60)).toBe(1380);
    expect(localMinutes(86_400_000 + 5 * 60_000, 0)).toBe(5);
  });
});

describe("luminance", () => {
  it("distingue texte sombre et clair", () => {
    expect(luminance("#1B1838")).toBeLessThan(0.3);
    expect(luminance("#FFF6E9")).toBeGreaterThan(0.8);
  });
});
