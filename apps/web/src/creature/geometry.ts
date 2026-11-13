// Géométrie de la scène : repère 240 de la créature (parties SVG) posé dans un cadre 240 x 300,
// conversions entre pixels de l'écran et unités du repère. Fonctions pures.
import type { Kind, Stage } from "@tamagoshi/rules";

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

type Profile = readonly (readonly [number, number])[];
type Grown = "child" | "teen" | "adult";

/**
 * Silhouettes des stades après le bébé, relevées du contour de `body.svg` de chaque stade (tous les 8 unités,
 * marge de 4 unités pour le doigt) : [hauteur, demi-largeur]. Kawaii grossit (largeur 140 à 164) ; féérique
 * s'allonge et monte (sommet y 45, 36, 28 au lieu de 54) ; pieds toujours à y 200.
 */
const PROFILES: Record<Kind, Record<Grown, Profile>> = {
  kawaii: {
    child: [[58,0],[64,28],[72,44],[80,54],[88,61],[96,67],[104,71],[112,74],[120,76],[128,77],[136,78],[144,78],[152,77],[160,75],[168,71],[176,66],[184,59],[192,49],[200,31],[208,0]],
    teen: [[52,0],[56,22],[64,42],[72,53],[80,61],[88,67],[96,72],[104,76],[112,78],[120,80],[128,81],[136,82],[144,82],[152,81],[160,78],[168,75],[176,70],[184,62],[192,51],[200,33],[208,0]],
    adult: [[46,0],[48,4],[56,39],[64,52],[72,61],[80,68],[88,73],[96,77],[104,81],[112,83],[120,85],[128,86],[136,86],[144,86],[152,84],[160,82],[168,78],[176,73],[184,65],[192,53],[200,34],[208,0]],
  },
  feerique: {
    child: [[43,0],[48,12],[56,20],[64,25],[72,29],[80,33],[88,37],[96,42],[104,47],[112,51],[120,56],[128,60],[136,63],[144,65],[152,66],[160,66],[168,64],[176,60],[184,54],[192,42],[200,4],[204,0]],
    teen: [[35,0],[40,13],[48,20],[56,25],[64,29],[72,33],[80,37],[88,41],[96,46],[104,50],[112,55],[120,59],[128,62],[136,65],[144,66],[152,67],[160,67],[168,65],[176,61],[184,54],[192,42],[200,4],[204,0]],
    adult: [[26,0],[32,14],[40,20],[48,25],[56,29],[64,33],[72,37],[80,41],[88,45],[96,49],[104,54],[112,58],[120,61],[128,64],[136,66],[144,67],[152,68],[160,67],[168,64],[176,60],[184,53],[192,42],[200,4],[204,0]],
  },
};

/**
 * Visage et sommet de la tête par stade (origines de `mouth` et `eye-left` des poses du stade). Kawaii : le
 * visage ne bouge pas, le corps grossit autour ; féérique : le visage monte avec le corps.
 */
const FACE: Record<Kind, Record<Grown, { mouthY: number; eyeY: number; headY: number }>> = {
  kawaii: {
    child: { mouthY: 152, eyeY: 132, headY: 76 },
    teen: { mouthY: 152, eyeY: 132, headY: 70 },
    adult: { mouthY: 152, eyeY: 132, headY: 64 },
  },
  feerique: {
    child: { mouthY: 157.5, eyeY: 138.5, headY: 69 },
    teen: { mouthY: 154, eyeY: 135, headY: 60 },
    adult: { mouthY: 150.5, eyeY: 131.5, headY: 52 },
  },
};

/** Zones de geste de chaque espèce au stade bébé (et pour l'œuf, qui n'a pas de zone propre). */
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

const grownCache = new Map<string, KindGeometry>();

/**
 * Stade de la créature affichée : stade par défaut de `geometryFor` et `insideBody`, pour que les zones de
 * geste suivent la créature sans que chaque appelant ait à passer le stade (la créature l’inscrit à l’affichage).
 */
let displayedStage: Stage = "baby";
export function setDisplayedStage(stage: Stage): void {
  displayedStage = stage;
}

/** Zones de geste de l'espèce au stade donné (par défaut celui de la créature affichée ; œuf ou stade inconnu : zones du bébé). */
export function geometryFor(kind: Kind, stage: Stage = displayedStage): KindGeometry {
  const k: Kind = GEOMETRY[kind] ? kind : "kawaii";
  if (stage !== "child" && stage !== "teen" && stage !== "adult") return GEOMETRY[k];
  const key = `${k}/${stage}`;
  let g = grownCache.get(key);
  if (!g) {
    const f = FACE[k][stage];
    g = {
      mouth: { x: 120, y: f.mouthY },
      head: { x: 120, y: f.headY },
      eyeY: f.eyeY,
      halfWidthAt: profileHalfWidth(PROFILES[k][stage]),
    };
    grownCache.set(key, g);
  }
  return g;
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
export function insideBody(u: Pt, kind: Kind = "kawaii", stage: Stage = displayedStage): boolean {
  const hw = geometryFor(kind, stage).halfWidthAt(u.y);
  return hw !== null && Math.abs(u.x - 120) <= hw;
}
