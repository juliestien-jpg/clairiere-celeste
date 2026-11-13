import { describe, expect, it } from "vitest";
import { formatLifespan, lifespanOf, starPoints } from "./albumFormat";

const HOUR = 3_600_000;

describe("album", () => {
  it("dit la durée de vie en toutes lettres", () => {
    expect(formatLifespan(10 * 60_000)).toBe("moins d'une heure");
    expect(formatLifespan(HOUR)).toBe("1 heure");
    expect(formatLifespan(5 * HOUR)).toBe("5 heures");
    expect(formatLifespan(24 * HOUR)).toBe("1 jour");
    expect(formatLifespan(76 * HOUR)).toBe("3 jours et 4 heures");
    expect(formatLifespan(NaN)).toBe("moins d'une heure");
    expect(lifespanOf({ bornAt: 10, flownAt: 5 })).toBe(0);
  });

  it("répartit les étoiles dans le ciel, sans jamais les coller", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}` }));
    const pts = starPoints(entries);
    expect(starPoints(entries)).toEqual(pts); // déterministe
    for (const p of pts) {
      expect(p.left).toBeGreaterThan(5);
      expect(p.left).toBeLessThan(95);
      expect(p.top).toBeGreaterThan(5);
      expect(p.top).toBeLessThan(95);
    }
    // Ciel de 340 x 300 px : deux étoiles à moins de 24 px se chevaucheraient trop (cibles de 48 px).
    let tooClose = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        if (!a || !b) continue;
        const dx = ((a.left - b.left) / 100) * 340;
        const dy = ((a.top - b.top) / 100) * 300;
        if (Math.hypot(dx, dy) < 24) tooClose++;
      }
    }
    expect(tooClose).toBe(0);
  });
});
