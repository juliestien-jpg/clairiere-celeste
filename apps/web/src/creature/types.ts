// Types du format de poses (spec/motion/README.md) : un vocabulaire volontairement réduit (D4).
// translation, rotation, échelle, opacité, boucles et courbes nommées. Rien d'autre.

export type Vec2 = readonly [number, number];

/** Pose tenue d'une cible, ou valeurs d'une image clé. `scale` : nombre ou [sx, sy]. */
export interface PoseTransform {
  translate?: Vec2 | undefined;
  rotate?: number | undefined;
  scale?: number | Vec2 | undefined;
  opacity?: number | undefined;
}

export interface Keyframe extends PoseTransform {
  offset: number;
  /** Courbe du segment qui suit cette image clé. */
  easing?: string;
}

export interface Loop {
  id: string;
  duration: number;
  iterations: "infinite" | number;
  easing: string;
  fill?: "none" | "forwards";
  delay?: number;
  targets: Record<string, readonly Keyframe[]>;
}

export interface Sequence extends Loop {
  /** Offset (0 à 1) de l'image figée en mouvement réduit. */
  reducedAt: number;
}

export interface ParticleRef {
  preset: string;
  continuous?: boolean;
  /** Offset de la séquence où déclencher une bouffée. */
  at?: number;
}

export interface StateDef {
  label: string;
  cue: string;
  emblem: string | null;
  visible: readonly string[];
  variants: Record<string, string>;
  static: Record<string, PoseTransform>;
  /** Absent : boucle de repos globale ; objet : la remplace ; null : aucune (Envol). */
  rest?: Loop | null;
  loops: readonly Loop[];
  sequence?: Sequence;
  after?: { loops: readonly Loop[] };
  particles: readonly ParticleRef[];
}

export interface PartDef {
  origin: Vec2;
  variants: Record<string, string>;
}

export interface EmblemDef {
  bubble: string;
  file: string;
  label: string;
}

export interface PosesSpec {
  version: number;
  /** Espèce décrite par ce fichier (poses/<espèce>.json). */
  kind?: string;
  transition: { duration: number; easing: string };
  reducedMotion: { transition: { duration: number; easing: string } };
  priority: readonly string[];
  easings: Record<string, readonly [number, number, number, number]>;
  targets: Record<string, { origin: Vec2 }>;
  parts: Record<string, PartDef>;
  layers: readonly string[];
  emblems: Record<string, EmblemDef>;
  rest: Loop;
  states: Record<string, StateDef>;
}

// --- Particules ---------------------------------------------------------------------------------

export type Range = readonly [number, number];
export type EmitterSpec =
  | { shape: "point"; center: Vec2 }
  | { shape: "ellipse"; center: Vec2; radii: Vec2 }
  | { shape: "line"; from: Vec2; to: Vec2 };

export type ParticleShape = "orb" | "sparkle4" | "bubble" | "leaf" | "moon" | "star";

export interface PresetSpec {
  label: string;
  mode: "continuous" | "burst";
  count?: number;
  emitDuration?: number;
  maxAlive?: number;
  spawnEveryMs?: Range;
  priority: number;
  emitter: EmitterSpec;
  shape: ParticleShape;
  colors: readonly string[];
  size: Range;
  life: Range;
  speed: Range;
  angle: Range;
  gravity: number;
  wander?: { amplitude: number; period: Range };
  spin?: Range;
  fade: { in: number; out: number };
  scaleOverLife: Range;
  glow: { radius: number; opacity: number };
  motion?: "free" | "spiral" | "converge";
  spiral?: { center: Vec2; radiusFrom: number; radiusTo: number; turns: number; rise: number };
  target?: Vec2;
  avoidFace?: boolean;
}

export interface ParticlesSpec {
  limits: { maxParticles: number };
  avoidZones: readonly { id: string; shape: "ellipse"; center: Vec2; radii: Vec2 }[];
  presets: Record<string, PresetSpec>;
}

// --- Thème --------------------------------------------------------------------------------------

export interface SkySpec {
  label: string;
  window: { from: string; to: string };
  gradient: { angle: number; stops: readonly { at: number; color: string }[] };
  stars: number;
  text: string;
  textMuted: string;
  panel: string;
  panelOpacity: number;
  panelEdge: string;
  moss: readonly [string, string];
  mist: string;
}

export type SkyId = "dawn" | "day" | "dusk" | "night";

export interface ThemeSpec {
  colors: Record<string, { hex: string; name: string }>;
  derived: Record<string, { hex: string }>;
  skies: Record<SkyId, SkySpec>;
  skyCrossfadeMinutes: number;
}
