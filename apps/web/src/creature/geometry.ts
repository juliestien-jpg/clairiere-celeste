// Géométrie de la scène : repère 240 de la créature (parties SVG) posé dans un cadre 240 x 300,
// conversions entre pixels de l'écran et unités du repère. Fonctions pures.
import type { Kind } from "@tamagoshi/rules";

export type Pt = { x: number; y: number };

export const VIEW_W = 240;
export const VIEW_H = 300;
/** La créature (repère 240) est posée dans le cadre 240 x 300 : l'emblème est au-dessus. */
export const POSE_OFFSET_Y = 60;

/** Zones de geste de chaque espèce, dans le repère de la créature (240). */
export interface KindGeometry {
  /** Bouche : cible des repas et des goûters. */
  mouth: Pt;
  /** Sommet de la tête, où l'étoile lancée est attrapée. */
  head: Pt;
  /** Hauteur des yeux : centre du regard. */
  eyeY: number;
  /** Demi-largeur du corps (unités) à une hauteur donnée, ou null hors du corps. */
  halfWidthAt(y: number): number | null;
}

function ellipseHalfWidth(cy: number, rx: number, ry: number): (y: number) => number | null {
  return (y) => {
    const dy = (y - cy) / ry;
    return dy * dy <= 1 ? rx * Math.sqrt(1 - dy * dy) : null;
  };
}

/** Interpolation linéaire d'un profil [hauteur, demi-largeur] trié par hauteur. */
function profileHalfWidth(profile: readonly (readonly [number, number])[]): (y: number) => number | null {
  return (y) => {
    const first = profile[0];
    const last = profile[profile.length - 1];
    if (!first || !last || y < first[0] || y > last[0]) return null;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1] as readonly [number, number];
      const b = profile[i] as readonly [number, number];
      if (y <= b[0]) return a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]);
    }
    return last[1];
  };
}

/**
 * Féérique : silhouette en goutte (sommet y 54, plus large à y 158, fond y 200), relevé du contour de
 * `body.svg` avec une marge de 4 unités pour le doigt. Une ellipse couvrirait trop de ciel autour du
 * sommet étroit et manquerait les épaules.
 */
const FEERIQUE_BODY_PROFILE: readonly (readonly [number, number])[] = [
  [50, 0], [54, 8], [62, 18], [70, 23], [78, 28], [86, 32], [94, 36], [102, 41], [110, 46], [118, 50],
  [126, 55], [134, 59], [142, 62], [150, 63], [158, 64], [166, 63], [174, 60], [182, 55], [190, 46],
  [198, 27], [204, 0],
];

export const GEOMETRY: Record<Kind, KindGeometry> = {
  kawaii: {
    mouth: { x: 120, y: 152 },
    head: { x: 120, y: 86 },
    eyeY: 132,
    halfWidthAt: ellipseHalfWidth(140, 70, 72),
  },
  feerique: {
    mouth: { x: 120, y: 161 },
    head: { x: 120, y: 78 },
    eyeY: 142,
    halfWidthAt: profileHalfWidth(FEERIQUE_BODY_PROFILE),
  },
};

export function geometryFor(kind: Kind): KindGeometry {
  return GEOMETRY[kind] ?? GEOMETRY.kawaii;
}

export interface StageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixels par unité du repère. */
export function unitScale(r: StageRect): number {
  return r.width / VIEW_W;
}

/** Point de l'écran (pixels) -> repère de la créature. */
export function clientToUnits(r: StageRect, p: Pt): Pt {
  const s = unitScale(r);
  return { x: (p.x - r.left) / s, y: (p.y - r.top) / s - POSE_OFFSET_Y };
}

/** Repère de la créature -> pixels de l'écran. */
export function unitsToClient(r: StageRect, u: Pt): Pt {
  const s = unitScale(r);
  return { x: r.left + u.x * s, y: r.top + (u.y + POSE_OFFSET_Y) * s };
}

/** Vrai si le point (repère de la créature) touche le corps de l'espèce. */
export function insideBody(u: Pt, kind: Kind = "kawaii"): boolean {
  const hw = geometryFor(kind).halfWidthAt(u.y);
  return hw !== null && Math.abs(u.x - 120) <= hw;
}
