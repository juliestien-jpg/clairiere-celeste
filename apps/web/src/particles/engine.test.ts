import { describe, expect, it } from "vitest";
import { particles } from "../creature/data";
import { ParticleEngine, fadeAlpha, insideEllipse, pointInEmitter } from "./engine";

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const colors = { "firefly-gold": "#FFD27A", "moonmilk-cream": "#FFF6E9", "moon-blue": "#A9C8FF", "dawn-pink": "#F4A6C6", "fairy-mint": "#8FE3CF" };

function engine(): ParticleEngine {
  return new ParticleEngine({ spec: particles, colors, rng: seeded(42) });
}

describe("fadeAlpha", () => {
  it("monte, tient, puis redescend", () => {
    const fade = { in: 0.2, out: 0.4 };
    expect(fadeAlpha(0, fade)).toBe(0);
    expect(fadeAlpha(0.1, fade)).toBeCloseTo(0.5);
    expect(fadeAlpha(0.5, fade)).toBe(1);
    expect(fadeAlpha(0.8, fade)).toBeCloseTo(0.5);
    expect(fadeAlpha(1, fade)).toBe(0);
  });
});

describe("émetteurs", () => {
  it("reste dans l'ellipse", () => {
    const rng = seeded(1);
    for (let i = 0; i < 200; i++) {
      const p = pointInEmitter({ shape: "ellipse", center: [120, 120], radii: [30, 10] }, rng);
      expect(insideEllipse(p, [120, 120], [30.0001, 10.0001])).toBe(true);
    }
  });
});

describe("plafond de particules (D4 : 40 au plus)", () => {
  it("ne dépasse jamais le plafond, tous préréglages confondus", () => {
    const e = engine();
    e.setContinuous(["ambient", "sleep"]);
    for (let i = 0; i < 4; i++) {
      e.burst({ preset: "flight" });
      e.burst({ preset: "play" });
      e.burst({ preset: "wash" });
      e.burst({ preset: "feed" });
    }
    for (let t = 0; t < 400; t++) {
      e.step(16);
      expect(e.count).toBeLessThanOrEqual(particles.limits.maxParticles);
    }
  });

  it("l'éclosion et les lucioles de l'affaiblie féérique restent sous le plafond", () => {
    const e = engine();
    e.setContinuous(["ambient"]); // préréglage de l'état `weak` féérique
    for (let i = 0; i < 3; i++) {
      e.burst({ preset: "hatch-kawaii" });
      e.burst({ preset: "hatch-feerique" });
    }
    for (let t = 0; t < 400; t++) {
      e.step(16);
      expect(e.count).toBeLessThanOrEqual(particles.limits.maxParticles);
    }
    for (const id of ["hatch-kawaii", "hatch-feerique"]) {
      expect(particles.presets[id], id).toBeDefined();
      expect(particles.presets[id]?.count ?? 0, id).toBeLessThanOrEqual(particles.limits.maxParticles);
    }
    expect(particles.presets["ambient"]?.maxAlive ?? 0).toBeLessThanOrEqual(particles.limits.maxParticles);
  });

  it("une particule de priorité plus haute prend la place d'une plus basse au plafond", () => {
    const e = engine();
    e.setContinuous(["ambient"]);
    for (let t = 0; t < 600; t++) e.step(50); // lucioles installées
    for (let i = 0; i < 3; i++) e.burst({ preset: "play", count: 20, emitDuration: 0 });
    e.step(16);
    e.burst({ preset: "flight", count: 10, emitDuration: 0 });
    e.step(16);
    expect(e.count).toBeLessThanOrEqual(40);
    expect(e.count).toBeGreaterThan(0);
  });

  it("toutes les particules finissent par mourir quand plus rien n'émet", () => {
    const e = engine();
    e.burst({ preset: "feed" });
    for (let t = 0; t < 400; t++) e.step(16);
    expect(e.count).toBe(0);
  });
});
