import { describe, expect, it } from "vitest";
import {
  GESTURE,
  PetStroke,
  PlaySession,
  ScrubTracker,
  dragState,
  dropOutcome,
  heldPosition,
  isDragStart,
  isFlick,
  isTap,
  releaseVelocity,
  throwApex,
} from "./recognizers";

describe("touche", () => {
  it("une touche bouge peu et dure peu", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 3, y: 2 }, 120)).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 40, y: 0 }, 120)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 1, y: 1 }, GESTURE.TAP_MAX_MS + 1)).toBe(false);
  });
  it("un glisser commence au seuil", () => {
    expect(isDragStart({ x: 0, y: 0 }, { x: GESTURE.DRAG_START_PX - 1, y: 0 })).toBe(false);
    expect(isDragStart({ x: 0, y: 0 }, { x: GESTURE.DRAG_START_PX, y: 0 })).toBe(true);
  });
});

describe("caresse", () => {
  it("devient suffisante une seule fois, après assez de chemin ET de durée", () => {
    const s = new PetStroke();
    let reached = 0;
    for (let i = 0; i <= 30; i++) {
      const r = s.add({ x: i * 0.05, y: 0 }, i * 50, true);
      if (r.justReached) reached++;
    }
    expect(reached).toBe(1);
  });
  it("un balayage rapide ne suffit pas (durée minimale)", () => {
    const s = new PetStroke();
    const r1 = s.add({ x: 0, y: 0 }, 0, true);
    const r2 = s.add({ x: 1.2, y: 0 }, GESTURE.PET_MIN_MS - 100, true);
    expect(r1.sufficient).toBe(false);
    expect(r2.path).toBeGreaterThan(GESTURE.PET_MIN_PATH);
    expect(r2.sufficient).toBe(false);
  });
  it("ne compte pas le trajet hors du corps", () => {
    const s = new PetStroke();
    s.add({ x: 0, y: 0 }, 0, true);
    s.add({ x: 5, y: 0 }, 100, false);
    const r = s.add({ x: 5.1, y: 0 }, 200, true);
    expect(r.path).toBeCloseTo(0, 5);
  });
});

describe("frottement", () => {
  function scrub(passes: number, width: number): ReturnType<ScrubTracker["add"]> {
    const t = new ScrubTracker();
    let last = t.add({ x: 0, y: 0 }, true);
    for (let p = 0; p < passes; p++) {
      const dir = p % 2 === 0 ? 1 : -1;
      for (let i = 1; i <= 10; i++) last = t.add({ x: dir === 1 ? (i * width) / 10 : width - (i * width) / 10, y: 0 }, true);
    }
    return last;
  }
  it("des allers-retours assez longs terminent le frottement", () => {
    const r = scrub(8, 0.5); // 4 largeurs de chemin, 7 changements de sens
    expect(r.enough).toBe(true);
    expect(r.progress).toBe(1);
    expect(r.reversals).toBeGreaterThanOrEqual(GESTURE.SCRUB_MIN_REVERSALS);
  });
  it("un long glissé sans retour ne suffit pas", () => {
    const t = new ScrubTracker();
    let r = t.add({ x: 0, y: 0 }, true);
    for (let i = 1; i <= 100; i++) r = t.add({ x: i * 0.05, y: 0 }, true);
    expect(r.progress).toBe(1);
    expect(r.enough).toBe(false);
  });
  it("la progression est proportionnelle au chemin, et justReached n'arrive qu'une fois", () => {
    const t = new ScrubTracker();
    t.add({ x: 0, y: 0 }, true);
    const half = t.add({ x: GESTURE.SCRUB_FULL_PATH / 2, y: 0 }, true);
    expect(half.progress).toBeCloseTo(0.5, 5);
    let count = 0;
    for (let i = 0; i < 40; i++) if (t.add({ x: i % 2 === 0 ? 0 : 0.5, y: 0 }, true).justReached) count++;
    expect(count).toBe(1);
  });
  it("ignore ce qui est hors du corps", () => {
    const t = new ScrubTracker();
    t.add({ x: 0, y: 0 }, true);
    t.add({ x: 3, y: 0 }, false);
    expect(t.add({ x: 3.1, y: 0 }, true).path).toBeCloseTo(0, 5);
  });
});

describe("glisser jusqu'à la bouche", () => {
  const mouth = { x: 100, y: 100 };
  const W = 200;
  it("loin, puis près (la bouche s'ouvre), puis sur la cible", () => {
    expect(dragState({ x: 100, y: 300 }, mouth, W, "mouth", false).phase).toBe("far");
    expect(dragState({ x: 100 + 0.25 * W, y: 100 }, mouth, W, "mouth", false).phase).toBe("near");
    expect(dragState({ x: 100 + 0.1 * W, y: 100 }, mouth, W, "mouth", false).phase).toBe("over");
  });
  it("la fiole se donne sur le corps, pas seulement à la bouche", () => {
    expect(dragState({ x: 100 + 0.3 * W, y: 100 }, mouth, W, "body", true).phase).toBe("over");
    expect(dragState({ x: 100 + 0.3 * W, y: 100 }, mouth, W, "body", false).phase).toBe("near");
  });
  it("lâcher sur la cible donne, ailleurs ou en annulant renvoie sur le plateau", () => {
    const over = dragState(mouth, mouth, W, "mouth", true);
    const far = dragState({ x: 0, y: 900 }, mouth, W, "mouth", false);
    expect(dropOutcome(over, false)).toBe("give");
    expect(dropOutcome(over, true)).toBe("return");
    expect(dropOutcome(far, false)).toBe("return");
  });
  it("l'objet est tenu au-dessus du doigt au tactile seulement", () => {
    expect(heldPosition({ x: 10, y: 200 }, "touch").y).toBe(200 - GESTURE.TOUCH_LIFT_PX);
    expect(heldPosition({ x: 10, y: 200 }, "mouse").y).toBe(200);
  });
});

describe("pichenette", () => {
  it("mesure la vitesse sur les derniers instants seulement", () => {
    const v = releaseVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 0, t: 400 },
      { x: 30, y: 0, t: 440 },
      { x: 60, y: 0, t: 480 },
    ]);
    expect(v.vx).toBeCloseTo(0.75, 5);
    expect(isFlick(v)).toBe(true);
  });
  it("un glissé lent n'est pas une pichenette", () => {
    const v = releaseVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 4, y: 0, t: 60 },
      { x: 8, y: 0, t: 120 },
    ]);
    expect(isFlick(v)).toBe(false);
    expect(releaseVelocity([])).toEqual({ vx: 0, vy: 0, speed: 0 });
  });
  it("le sommet du lancer reste dans le cadre", () => {
    const v = { vx: 0, vy: -3, speed: 3 };
    const a = throwApex({ x: 100, y: 120 }, v, 200, { left: 0, top: 50, right: 300, bottom: 600 });
    expect(a.y).toBe(50);
    expect(a.x).toBe(100);
  });
});

describe("partie de jeu", () => {
  it("n'envoie play qu'une fois par partie, après plusieurs touches", () => {
    const s = new PlaySession();
    expect(s.touch(0)).toBe(false);
    expect(s.touch(1000)).toBe(false);
    expect(s.touch(2000)).toBe(true);
    expect(s.touch(3000)).toBe(false);
    expect(s.touch(4000)).toBe(false);
  });
  it("une étoile attrapée fait une partie à elle seule", () => {
    const s = new PlaySession();
    expect(s.caught(0)).toBe(true);
    expect(s.caught(500)).toBe(false);
  });
  it("une pause longue en commence une nouvelle", () => {
    const s = new PlaySession();
    expect(s.caught(0)).toBe(true);
    expect(s.touch(GESTURE.PLAY_SESSION_GAP_MS + 100)).toBe(false);
    s.touch(GESTURE.PLAY_SESSION_GAP_MS + 200);
    expect(s.touch(GESTURE.PLAY_SESSION_GAP_MS + 300)).toBe(true);
  });
});
