import { describe, expect, it } from "vitest";
import { GEOMETRY, clientToUnits, geometryFor, insideBody, unitsToClient } from "./geometry";

describe("zones de geste par espèce (D6)", () => {
  it("la bouche et la tête suivent la silhouette de l'espèce", () => {
    expect(geometryFor("kawaii").mouth).toEqual({ x: 120, y: 152 });
    expect(geometryFor("feerique").mouth).toEqual({ x: 120, y: 161 });
    // La bouche féérique est plus bas que chez kawaii (yeux à y 142, bouche à y 161) et la tête plus haut.
    expect(GEOMETRY.feerique.mouth.y).toBeGreaterThan(GEOMETRY.kawaii.mouth.y);
    expect(GEOMETRY.feerique.head.y).toBeLessThan(GEOMETRY.kawaii.head.y);
  });
  it("la bouche, la tête et les yeux sont à l'intérieur du corps de leur espèce", () => {
    for (const kind of ["kawaii", "feerique"] as const) {
      expect(insideBody(GEOMETRY[kind].mouth, kind), `${kind} bouche`).toBe(true);
      expect(insideBody(GEOMETRY[kind].head, kind), `${kind} tête`).toBe(true);
      expect(insideBody({ x: 120, y: GEOMETRY[kind].eyeY }, kind), `${kind} yeux`).toBe(true);
    }
  });
  it("kawaii garde son ellipse d'origine (rx 70, ry 72, centre 120,140)", () => {
    expect(insideBody({ x: 120 + 69, y: 140 })).toBe(true);
    expect(insideBody({ x: 120 + 72, y: 140 })).toBe(false);
    expect(insideBody({ x: 120, y: 140 - 71 })).toBe(true);
    expect(insideBody({ x: 120, y: 140 + 73 })).toBe(false);
  });
  it("la goutte féérique est étroite au sommet et large en bas", () => {
    // Près du sommet (y 86), un point à 40 unités du centre est hors de la goutte mais dans l'ellipse kawaii.
    expect(insideBody({ x: 160, y: 86 }, "feerique")).toBe(false);
    expect(insideBody({ x: 160, y: 86 }, "kawaii")).toBe(true);
    // Le ventre (y 150) est couvert jusqu'au bord du corps (60 unités, plus la marge du doigt).
    expect(insideBody({ x: 120 + 62, y: 150 }, "feerique")).toBe(true);
    expect(insideBody({ x: 120 + 70, y: 150 }, "feerique")).toBe(false);
    expect(insideBody({ x: 120 - 62, y: 150 }, "feerique")).toBe(true);
  });
  it("hors de la goutte : au-dessus du sommet (antennes) et sous le fond", () => {
    expect(insideBody({ x: 120, y: 40 }, "feerique")).toBe(false);
    expect(insideBody({ x: 120, y: 56 }, "feerique")).toBe(true);
    expect(insideBody({ x: 120, y: 206 }, "feerique")).toBe(false);
  });
  it("le profil couvre le contour du corps relevé dans body.svg", () => {
    // Points du contour (côté droit) relevés sur les courbes de body.svg : [y, demi-largeur].
    const outline: [number, number][] = [[62, 13.8], [86, 28], [102, 37.1], [118, 46.6], [134, 54.9], [150, 59.5], [158, 60], [174, 56.6], [190, 42.2]];
    for (const [y, hw] of outline) expect(insideBody({ x: 120 + hw, y }, "feerique"), `y ${y}`).toBe(true);
  });
  it("conversions écran <-> repère inchangées", () => {
    const rect = { left: 10, top: 20, width: 240, height: 300 };
    const u = clientToUnits(rect, unitsToClient(rect, { x: 100, y: 120 }));
    expect(u.x).toBeCloseTo(100);
    expect(u.y).toBeCloseTo(120);
  });
});
