// Reconnaissance des gestes sur la créature : fonctions et petites machines pures, sans DOM, testées.
// Les distances sont en « largeurs de scène » (largeur de la zone de la créature à l'écran) pour que les
// seuils tiennent sur un petit téléphone comme sur un grand écran ; les durées sont en millisecondes.
// TOUS les seuils sont ici, nommés : c'est le seul endroit à régler.
import type { Pt } from "../creature/geometry";

export const GESTURE = {
  /** Déplacement (pixels) à partir duquel un appui devient un glisser. */
  DRAG_START_PX: 8,
  /** Un appui qui bouge moins que cela (pixels) et dure moins que TAP_MAX_MS est une touche. */
  TAP_MAX_MOVE_PX: 10,
  TAP_MAX_MS: 450,

  /** Caresse : chemin parcouru sur le corps (largeurs de scène) et durée minimale du geste. */
  PET_MIN_PATH: 0.7,
  PET_MIN_MS: 300,

  /** Frottement : chemin total sur le corps pour tout nettoyer, et nombre d'allers-retours exigés. */
  SCRUB_FULL_PATH: 2.6,
  SCRUB_MIN_REVERSALS: 4,
  /** Déplacement minimal (largeurs) entre deux mesures de direction du frottement. */
  SCRUB_MIN_SEGMENT: 0.05,
  /** Distance frottée (largeurs) entre deux petites bouffées de bulles. */
  SCRUB_BUBBLE_EVERY: 0.45,

  /** Glisser un objet : la bouche s'ouvre à moins de APPROACH de la bouche, on lâche à moins de DROP. */
  MOUTH_APPROACH: 0.34,
  MOUTH_DROP: 0.16,
  /** Sur écran tactile, l'objet est tenu au-dessus du doigt (pixels) pour ne pas cacher le visage. */
  TOUCH_LIFT_PX: 56,

  /** Pichenette : vitesse minimale à la relâche (pixels par ms), mesurée sur FLICK_WINDOW_MS. */
  FLICK_MIN_SPEED: 0.7,
  FLICK_WINDOW_MS: 90,
  /** Portée de la pichenette (ms de vitesse convertis en distance, plafonnée en largeurs). */
  THROW_REACH_MS: 260,
  THROW_MAX_REACH: 0.9,

  /** Jouer : touches pour qu'une partie compte, et silence (ms) qui la termine. */
  PLAY_TOUCHES: 3,
  PLAY_SESSION_GAP_MS: 8000,

  /** Retour haptique (ms), quand le navigateur sait vibrer. */
  HAPTIC_MS: 12,
  HAPTIC_DONE_MS: 24,
} as const;

export type GestureConfig = typeof GESTURE;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Touche ---------------------------------------------------------------------------------------

export function isTap(start: Pt, end: Pt, durationMs: number, cfg: GestureConfig = GESTURE): boolean {
  return dist(start, end) <= cfg.TAP_MAX_MOVE_PX && durationMs <= cfg.TAP_MAX_MS;
}

export function isDragStart(start: Pt, now: Pt, cfg: GestureConfig = GESTURE): boolean {
  return dist(start, now) >= cfg.DRAG_START_PX;
}

// --- Caresse --------------------------------------------------------------------------------------

export interface StrokeProgress {
  /** Chemin cumulé sur le corps (largeurs de scène). */
  path: number;
  sufficient: boolean;
  /** Vrai une seule fois : à l'instant où le geste devient suffisant. */
  justReached: boolean;
}

/** Une caresse : un doigt qui glisse doucement sur le corps, assez longtemps et assez loin. */
export class PetStroke {
  private path = 0;
  private last: Pt | null = null;
  private startT: number | null = null;
  private reached = false;

  constructor(private readonly cfg: GestureConfig = GESTURE) {}

  /** `p` en largeurs de scène, `inside` : le point touche le corps. */
  add(p: Pt, t: number, inside: boolean): StrokeProgress {
    if (!inside) {
      this.last = null; // le doigt est sorti : on ne compte pas le trajet hors du corps
    } else {
      this.startT ??= t;
      if (this.last) this.path += dist(this.last, p);
      this.last = p;
    }
    const sufficient = this.path >= this.cfg.PET_MIN_PATH && this.startT !== null && t - this.startT >= this.cfg.PET_MIN_MS;
    const justReached = sufficient && !this.reached;
    if (justReached) this.reached = true;
    return { path: this.path, sufficient, justReached };
  }
}

// --- Frottement -----------------------------------------------------------------------------------

export interface ScrubProgress {
  /** 0 à 1 : sert à effacer les taches au fil du frottement. */
  progress: number;
  reversals: number;
  enough: boolean;
  justReached: boolean;
  /** Chemin cumulé (largeurs de scène). */
  path: number;
}

/** Frottement : chemin cumulé sur le corps ET allers-retours (un simple glissé ne suffit pas). */
export class ScrubTracker {
  private path = 0;
  private last: Pt | null = null;
  private anchor: Pt | null = null;
  private dir: Pt | null = null;
  private reversals = 0;
  private reached = false;

  constructor(private readonly cfg: GestureConfig = GESTURE) {}

  /** Le doigt se lève : le trajet repart de zéro au prochain appui, la progression reste. */
  lift(): void {
    this.last = null;
    this.anchor = null;
    this.dir = null;
  }

  add(p: Pt, inside: boolean): ScrubProgress {
    if (!inside) {
      this.last = null;
      this.anchor = null;
    } else {
      if (this.last) this.path += dist(this.last, p);
      this.last = p;
      if (!this.anchor) this.anchor = p;
      const d = { x: p.x - this.anchor.x, y: p.y - this.anchor.y };
      if (Math.hypot(d.x, d.y) >= this.cfg.SCRUB_MIN_SEGMENT) {
        if (this.dir && d.x * this.dir.x + d.y * this.dir.y < 0) this.reversals++;
        this.dir = d;
        this.anchor = p;
      }
    }
    const progress = Math.min(1, this.path / this.cfg.SCRUB_FULL_PATH);
    const enough = progress >= 1 && this.reversals >= this.cfg.SCRUB_MIN_REVERSALS;
    const justReached = enough && !this.reached;
    if (justReached) this.reached = true;
    return { progress, reversals: this.reversals, enough, justReached, path: this.path };
  }
}

// --- Glisser un objet jusqu'à la créature -----------------------------------------------------------

export type DragTarget = "mouth" | "body";
export type DragPhase = "far" | "near" | "over";

export interface DragState {
  phase: DragPhase;
  /** Distance à la bouche, en largeurs de scène. */
  distance: number;
}

/**
 * Où en est l'objet tenu : loin, près de la bouche (elle s'ouvre), ou sur la cible (on peut lâcher).
 * Cible « mouth » (repas, goûter) : à moins de MOUTH_DROP de la bouche. Cible « body » (fiole) : sur le corps.
 */
export function dragState(item: Pt, mouth: Pt, sceneWidth: number, target: DragTarget, overBody: boolean, cfg: GestureConfig = GESTURE): DragState {
  const distance = dist(item, mouth) / sceneWidth;
  const near = distance <= cfg.MOUTH_APPROACH;
  const over = target === "mouth" ? distance <= cfg.MOUTH_DROP : overBody;
  return { phase: over ? "over" : near ? "near" : "far", distance };
}

/** À la relâche : l'objet est donné à la créature, ou il revient sur le plateau. */
export function dropOutcome(state: DragState, cancelled: boolean): "give" | "return" {
  return !cancelled && state.phase === "over" ? "give" : "return";
}

/** Position de l'objet tenu : au-dessus du doigt sur écran tactile, sous le curseur sinon. */
export function heldPosition(pointer: Pt, pointerType: string, cfg: GestureConfig = GESTURE): Pt {
  return pointerType === "touch" || pointerType === "pen" ? { x: pointer.x, y: pointer.y - cfg.TOUCH_LIFT_PX } : pointer;
}

// --- Pichenette -------------------------------------------------------------------------------------

export interface Sample extends Pt {
  t: number;
}

export interface Velocity {
  vx: number;
  vy: number;
  /** Pixels par milliseconde. */
  speed: number;
}

/** Vitesse du doigt à la relâche, sur les derniers FLICK_WINDOW_MS. */
export function releaseVelocity(samples: readonly Sample[], cfg: GestureConfig = GESTURE): Velocity {
  const end = samples[samples.length - 1];
  if (!end) return { vx: 0, vy: 0, speed: 0 };
  let start = end;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i] as Sample;
    if (end.t - s.t > cfg.FLICK_WINDOW_MS) break;
    start = s;
  }
  const dt = end.t - start.t;
  if (dt <= 0) return { vx: 0, vy: 0, speed: 0 };
  const vx = (end.x - start.x) / dt;
  const vy = (end.y - start.y) / dt;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

export function isFlick(v: Velocity, cfg: GestureConfig = GESTURE): boolean {
  return v.speed >= cfg.FLICK_MIN_SPEED;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Point le plus haut de la trajectoire d'une étoile lancée : dans le sens de la pichenette, dans le cadre. */
export function throwApex(release: Pt, v: Velocity, sceneWidth: number, bounds: Bounds, cfg: GestureConfig = GESTURE): Pt {
  const reach = Math.min(v.speed * cfg.THROW_REACH_MS, cfg.THROW_MAX_REACH * sceneWidth);
  const ux = v.speed > 0 ? v.vx / v.speed : 0;
  const uy = v.speed > 0 ? v.vy / v.speed : -1;
  return {
    x: Math.min(bounds.right, Math.max(bounds.left, release.x + ux * reach)),
    y: Math.min(bounds.bottom, Math.max(bounds.top, release.y + uy * reach)),
  };
}

// --- Partie de jeu ----------------------------------------------------------------------------------

/**
 * Une partie : une suite de touches (ou une étoile attrapée) rapprochées dans le temps. L'action `play`
 * n'est envoyée qu'une fois par partie ; une pause de PLAY_SESSION_GAP_MS en commence une nouvelle.
 */
export class PlaySession {
  private touches = 0;
  private lastAt = Number.NEGATIVE_INFINITY;
  private sent = false;

  constructor(private readonly cfg: GestureConfig = GESTURE) {}

  /** Une touche ; renvoie vrai quand il faut envoyer `play` (une seule fois par partie). */
  touch(nowMs: number): boolean {
    return this.register(nowMs, 1);
  }

  /** Étoile attrapée : à elle seule, elle fait une partie. */
  caught(nowMs: number): boolean {
    return this.register(nowMs, this.cfg.PLAY_TOUCHES);
  }

  private register(nowMs: number, weight: number): boolean {
    if (nowMs - this.lastAt > this.cfg.PLAY_SESSION_GAP_MS) {
      this.touches = 0;
      this.sent = false;
    }
    this.lastAt = nowMs;
    this.touches += weight;
    if (!this.sent && this.touches >= this.cfg.PLAY_TOUCHES) {
      this.sent = true;
      return true;
    }
    return false;
  }
}
