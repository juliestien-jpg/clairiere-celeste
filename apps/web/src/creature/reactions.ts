// Réactions de la créature (spec/motion/reactions.json) : types, choix de la réaction d'une action,
// plan d'une réaction (fonctions pures, testées) et contrôle de cohérence des données.
// Le jeu des images clés est celui de poses.json : translate, rotate, scale, opacity. Rien d'autre (D4).
import type { Action, GameEvent, Kind } from "@tamagoshi/rules";
import type { Keyframe, ParticlesSpec, PosesSpec, Vec2 } from "./types";

export interface PropDef {
  /** Fichier relatif à `assets/` (profil SVG restreint de D4, viewBox 48 x 48). */
  file: string;
  /** Centre de l'accessoire dans le repère 240 de la créature. */
  at: Vec2;
  /** Largeur dessinée, en unités du repère 240. */
  size: number;
}

/** Variante de partie tenue pendant [from, to] (offsets de 0 à 1). */
export interface SwapDef {
  part: string;
  variant: string;
  from: number;
  to: number;
}

export interface ParticleCue {
  preset: string;
  at: number;
  count?: number;
  emitDuration?: number;
}

export interface ReactionDef {
  label: string;
  cue: string;
  duration: number;
  easing: string;
  /** Cible (partie, groupe `touch` / `gaze`, ou accessoire) → images clés. */
  tracks: Record<string, readonly Keyframe[]>;
  swaps: readonly SwapDef[];
  particles: readonly ParticleCue[];
}

/**
 * Cible commune à plusieurs espèces (D6) : `head-tips` vaut les oreilles chez kawaii et les antennes chez
 * féérique ; `wings` n'existe que chez féérique. `parts` donne, par espèce, les parties visées.
 * - `mirror` : `parts` est la paire [gauche, droite] ; les images clés décrivent le côté DROIT (rotation
 *   positive = vers l'extérieur) et la partie gauche reçoit la rotation et la translation horizontale opposées.
 * - `additive` : les images clés sont des écarts, ajoutés à la pose de l'état et à ses boucles (les antennes
 *   tombantes d'un animal fatigué ne sont pas redressées par la réaction).
 */
export interface TargetGroup {
  mirror: boolean;
  additive: boolean;
  parts: Partial<Record<Kind, readonly string[]>>;
}

export interface ReactionsSpec {
  version: number;
  limits: { minDuration: number; maxDuration: number };
  targets: Record<string, { origin: Vec2 }>;
  groups: Record<string, TargetGroup>;
  props: Record<string, PropDef>;
  reactions: Record<string, ReactionDef>;
}

// --- Choix de la réaction --------------------------------------------------------------------------

/** Réaction jouée quand une action est acceptée. */
export function reactionForAction(action: Action): string | null {
  switch (action.type) {
    case "feed":
      return action.food === "snack" ? "feed-snack" : "feed-meal";
    case "clean":
      return "wash";
    case "heal":
      return "heal";
    case "play":
      return "play";
    case "pet":
      return "pet";
    case "sleep":
      return "sleep";
    case "wake":
      return "wake";
    default:
      return null;
  }
}

/**
 * Réaction d'une action après passage dans les règles. Un refus donne le hochement de tête doux,
 * sauf pour la caresse : « pet » refusé (temps de recharge, etc.) reste tendre et sans reproche.
 */
export function reactionForOutcome(action: Action, events: readonly GameEvent[]): string | null {
  const refused = events.some((e) => e.type === "actionRefused" && e.action === action.type);
  if (!refused) return reactionForAction(action);
  if (action.type === "pet") return "pet";
  if (action.type === "tick" || action.type === "rebirth") return null;
  return "refuse";
}

// --- Cibles communes -------------------------------------------------------------------------------

/** Images clés du côté gauche d'un groupe symétrique : rotation et translation horizontale inversées. */
function mirrorFrames(frames: readonly Keyframe[]): Keyframe[] {
  return frames.map((k) => {
    const out: Keyframe = { ...k };
    if (k.rotate !== undefined) out.rotate = k.rotate === 0 ? 0 : -k.rotate;
    if (k.translate !== undefined) out.translate = [k.translate[0] === 0 ? 0 : -k.translate[0], k.translate[1]];
    return out;
  });
}

export interface ResolvedTrack {
  target: string;
  frames: readonly Keyframe[];
  additive: boolean;
}

/**
 * Remplace chaque groupe commun par les parties de l'espèce affichée. Un groupe absent de l'espèce
 * (`wings` chez kawaii) disparaît sans erreur ; les autres cibles passent telles quelles.
 */
export function resolveTracks(
  tracks: Record<string, readonly Keyframe[]>,
  groups: Record<string, TargetGroup>,
  kind: Kind,
): ResolvedTrack[] {
  const out: ResolvedTrack[] = [];
  for (const [name, frames] of Object.entries(tracks)) {
    const group = groups[name];
    if (!group) {
      out.push({ target: name, frames, additive: false });
      continue;
    }
    const parts = group.parts[kind];
    if (!parts || parts.length === 0) continue;
    if (group.mirror && parts.length === 2) {
      out.push({ target: parts[0] as string, frames: mirrorFrames(frames), additive: group.additive });
      out.push({ target: parts[1] as string, frames, additive: group.additive });
    } else {
      for (const part of parts) out.push({ target: part, frames, additive: group.additive });
    }
  }
  return out;
}

// --- Plan d'une réaction ---------------------------------------------------------------------------

export interface TrackPlan {
  target: string;
  frames: readonly Keyframe[];
  /** Images clés d'écarts, ajoutées à ce qui joue déjà sur la partie (voir TargetGroup). */
  additive: boolean;
}

export interface WindowPlan {
  part: string;
  variant: string;
  /** Fenêtres [from, to] où la variante est visible. */
  windows: readonly (readonly [number, number])[];
}

export interface ReactionPlan {
  duration: number;
  easing: string;
  tracks: readonly TrackPlan[];
  /** Une entrée par couple (partie, variante). */
  swaps: readonly WindowPlan[];
  particles: readonly ParticleCue[];
}

/**
 * Mouvement réduit : pas de rebond ni de particule. Les accessoires et les parties n'ont plus que leurs
 * fondus (opacité) ; les expressions du visage se réduisent à la dernière tenue de chaque partie (pose fixe).
 */
export function planReaction(
  def: ReactionDef,
  props: Record<string, PropDef>,
  reduced: boolean,
  species?: { groups: Record<string, TargetGroup>; kind: Kind },
): ReactionPlan {
  let tracks: TrackPlan[] = species
    ? resolveTracks(def.tracks, species.groups, species.kind)
    : Object.entries(def.tracks).map(([target, frames]) => ({ target, frames, additive: false }));
  let swaps = def.swaps;
  let particles = def.particles;
  if (reduced) {
    tracks = tracks
      .filter((t) => t.frames.some((k) => k.opacity !== undefined))
      .map((t) => ({
        target: t.target,
        additive: t.additive,
        frames: t.frames.map((k) => (k.opacity === undefined ? { offset: k.offset } : { offset: k.offset, opacity: k.opacity })),
      }));
    const lastByPart = new Map<string, SwapDef>();
    for (const s of def.swaps) {
      const cur = lastByPart.get(s.part);
      if (!cur || s.to > cur.to || (s.to === cur.to && s.from > cur.from)) lastByPart.set(s.part, s);
    }
    swaps = [...lastByPart.values()];
    particles = [];
  }
  void props;
  const grouped = new Map<string, { part: string; variant: string; windows: [number, number][] }>();
  for (const s of swaps) {
    const key = `${s.part}\u0000${s.variant}`;
    const g = grouped.get(key) ?? { part: s.part, variant: s.variant, windows: [] };
    g.windows.push([s.from, s.to]);
    grouped.set(key, g);
  }
  return { duration: def.duration, easing: def.easing, tracks, swaps: [...grouped.values()], particles };
}

const EPS = 0.0005;

/**
 * Images clés d'opacité (0 ou 1) d'un élément visible seulement dans les fenêtres données
 * (`visibleInside` vrai : variante ajoutée) ou masqué seulement dedans (faux : partie de base).
 * Passage net, sans fondu : une expression change d'un coup.
 */
export function windowOpacityFrames(
  windows: readonly (readonly [number, number])[],
  visibleInside: boolean,
): { offset: number; opacity: number }[] {
  const inside = visibleInside ? 1 : 0;
  const outside = 1 - inside;
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const frames: { offset: number; opacity: number }[] = [{ offset: 0, opacity: outside }];
  const push = (offset: number, opacity: number): void => {
    const last = frames[frames.length - 1] as { offset: number; opacity: number };
    const o = Math.min(1, Math.max(last.offset, offset));
    if (o === last.offset && last.opacity === opacity) return;
    frames.push({ offset: o, opacity });
  };
  for (const [from, to] of sorted) {
    push(from - EPS, outside);
    push(from, inside);
    push(to - EPS, inside);
    push(to, outside);
  }
  push(1, (frames[frames.length - 1] as { opacity: number }).opacity);
  // Offsets strictement croissants : on décale les égalités d'un epsilon.
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1] as { offset: number };
    const cur = frames[i] as { offset: number };
    if (cur.offset <= prev.offset) cur.offset = Math.min(1, prev.offset + EPS / 10);
  }
  return frames;
}

// --- Contrôle des données --------------------------------------------------------------------------

export const REQUIRED_REACTIONS = [
  "feed-meal",
  "feed-snack",
  "wash",
  "heal",
  "play",
  "pet",
  "sleep",
  "wake",
  "refuse",
  "tap",
  "catch",
  "hatch-kawaii",
  "hatch-feerique",
] as const;

/** Réaction jouée à l'éclosion, où l'espèce se découvre (D6). */
export function hatchReaction(kind: Kind): string {
  return `hatch-${kind}`;
}

/** Liste des incohérences de reactions.json (vide si tout va bien), pour toutes les espèces. */
export function validateReactions(
  spec: ReactionsSpec,
  posesByKind: Record<Kind, PosesSpec>,
  particles: ParticlesSpec,
  fileExists: (file: string) => boolean,
): string[] {
  const problems: string[] = [];
  const kinds = Object.keys(posesByKind) as Kind[];
  const anyPoses = (f: (p: PosesSpec) => boolean): boolean => kinds.some((k) => f(posesByKind[k]));
  const known = (name: string): boolean =>
    name in spec.targets || name in spec.groups || name in spec.props || anyPoses((p) => name in p.targets || name in p.parts);
  const easings = posesByKind[kinds[0] as Kind].easings;
  for (const [id, p] of Object.entries(spec.props)) {
    if (!fileExists(p.file)) problems.push(`accessoire ${id} : fichier introuvable ${p.file}`);
    if (id in spec.groups || id in spec.targets || anyPoses((q) => id in q.parts || id in q.targets))
      problems.push(`accessoire ${id} : nom déjà pris`);
  }
  for (const [id, g] of Object.entries(spec.groups)) {
    if (id in spec.targets || anyPoses((q) => id in q.parts || id in q.targets)) problems.push(`groupe ${id} : nom déjà pris`);
    for (const k of Object.keys(g.parts) as Kind[]) {
      const poses = posesByKind[k];
      if (!poses) {
        problems.push(`groupe ${id} : espèce inconnue ${k}`);
        continue;
      }
      const list = g.parts[k] ?? [];
      if (g.mirror && list.length !== 2) problems.push(`groupe ${id} : ${k} doit donner la paire [gauche, droite]`);
      for (const part of list) if (!(part in poses.parts)) problems.push(`groupe ${id} : partie ${part} absente de ${k}`);
    }
  }
  for (const [id, r] of Object.entries(spec.reactions)) {
    const at = (m: string): string => `${id} : ${m}`;
    if (r.duration < spec.limits.minDuration || r.duration > spec.limits.maxDuration)
      problems.push(at(`durée ${r.duration} hors de ${spec.limits.minDuration}-${spec.limits.maxDuration} ms`));
    if (!(r.easing in easings)) problems.push(at(`courbe inconnue ${r.easing}`));
    for (const [target, frames] of Object.entries(r.tracks)) {
      if (!known(target)) problems.push(at(`cible inconnue ${target}`));
      if (frames.length < 2) problems.push(at(`${target} : au moins deux images clés`));
      if (frames[0]?.offset !== 0 || frames[frames.length - 1]?.offset !== 1) problems.push(at(`${target} : offsets 0 et 1 obligatoires`));
      frames.forEach((k, i) => {
        if (i > 0 && k.offset < (frames[i - 1] as Keyframe).offset) problems.push(at(`${target} : offsets non croissants`));
        if (k.easing !== undefined && !(k.easing in easings)) problems.push(at(`${target} : courbe inconnue ${k.easing}`));
      });
      if (target in spec.props && !frames.some((k) => k.opacity !== undefined))
        problems.push(at(`${target} : un accessoire fixe son opacité`));
    }
    // Une même partie ne peut pas être visée à la fois par son nom et par un groupe (ni par deux groupes).
    for (const k of kinds) {
      const viaGroups = Object.keys(r.tracks)
        .filter((n) => n in spec.groups)
        .flatMap((n) => spec.groups[n]?.parts[k] ?? []);
      const direct = Object.keys(r.tracks).filter((n) => !(n in spec.groups));
      for (const n of [...direct, ...viaGroups]) {
        const count = [...direct, ...viaGroups].filter((m) => m === n).length;
        if (count > 1) problems.push(at(`${k} : cible ${n} visée deux fois`));
      }
    }
    const byPart = new Map<string, SwapDef[]>();
    for (const s of r.swaps) {
      for (const k of kinds) {
        const variants = posesByKind[k].parts[s.part]?.variants;
        if (!variants) problems.push(at(`swap : partie inconnue ${s.part} (${k})`));
        else if (!(s.variant in variants)) problems.push(at(`swap : variante inconnue ${s.part}/${s.variant} (${k})`));
      }
      if (!(s.from >= 0 && s.from < s.to && s.to <= 1)) problems.push(at(`swap ${s.part}/${s.variant} : fenêtre invalide`));
      byPart.set(s.part, [...(byPart.get(s.part) ?? []), s]);
    }
    for (const [part, list] of byPart) {
      const sorted = [...list].sort((a, b) => a.from - b.from);
      for (let i = 1; i < sorted.length; i++) {
        if ((sorted[i] as SwapDef).from < (sorted[i - 1] as SwapDef).to) problems.push(at(`swap ${part} : fenêtres qui se chevauchent`));
      }
    }
    for (const c of r.particles) {
      const p = particles.presets[c.preset];
      if (!p) problems.push(at(`préréglage de particules inconnu ${c.preset}`));
      if (!(c.at >= 0 && c.at <= 1)) problems.push(at(`particules : offset ${c.at} hors de 0-1`));
      if (p && (c.count ?? p.count ?? p.maxAlive ?? 0) > particles.limits.maxParticles)
        problems.push(at(`particules : plus de ${particles.limits.maxParticles}`));
    }
  }
  for (const id of REQUIRED_REACTIONS) if (!spec.reactions[id]) problems.push(`réaction manquante : ${id}`);
  return problems;
}
