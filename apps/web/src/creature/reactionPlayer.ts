// Joue une réaction (spec/motion/reactions.json) sur la couche SVG de la créature : API Web Animations,
// uniquement `transform` et `opacity` (D4). Ajoute au vocabulaire des poses deux choses : des accessoires
// (groupes SVG créés puis retirés) et des variantes de partie tenues pendant une fenêtre (expressions).
import type { Kind } from "@tamagoshi/rules";
import { burstChannel } from "./effects";
import { buildKeyframes, transformString } from "./motion";
import { planReaction, windowOpacityFrames } from "./reactions";
import type { ReactionsSpec } from "./reactions";
import { prefixIds } from "./svgParts";
import type { Loop, PoseTransform, PosesSpec, StateDef, Vec2 } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface PlayerContext {
  /** Espèce affichée : choisit les parties des groupes communs (head-tips, wings…). */
  kind: Kind;
  /** Poses de cette espèce. */
  poses: PosesSpec;
  reactions: ReactionsSpec;
  /** Contenu SVG d'un fichier de `assets/`. */
  svgInner: (file: string) => string;
}

export interface ReactionHandle {
  cancel(): void;
  finished: Promise<void>;
}

let uid = 0;

function target(root: Element, name: string): SVGElement | null {
  return root.querySelector<SVGElement>(`[data-target="${name}"]`);
}

function originOf(ctx: PlayerContext, name: string): Vec2 | null {
  const prop = ctx.reactions.props[name];
  if (prop) return prop.at;
  return ctx.reactions.targets[name]?.origin ?? ctx.poses.targets[name]?.origin ?? ctx.poses.parts[name]?.origin ?? null;
}

function setOrigin(el: SVGElement, origin: Vec2): void {
  el.style.transformBox = "view-box";
  el.style.transformOrigin = `${origin[0]}px ${origin[1]}px`;
}

/** Groupe d'un accessoire, au-dessus de la créature, invisible jusqu'à sa première image clé. */
function createProp(root: Element, ctx: PlayerContext, id: string): SVGElement | null {
  const def = ctx.reactions.props[id];
  const host = root.firstElementChild;
  if (!def || !host) return null;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-target", id);
  g.setAttribute("data-prop", "true");
  g.style.opacity = "0";
  const art = document.createElementNS(SVG_NS, "g");
  art.setAttribute(
    "transform",
    `translate(${def.at[0] - def.size / 2} ${def.at[1] - def.size / 2}) scale(${def.size / 48})`,
  );
  art.innerHTML = prefixIds(ctx.svgInner(def.file), `prop${++uid}`);
  g.appendChild(art);
  host.appendChild(g);
  setOrigin(g, def.at);
  return g;
}

/** Calque d'une variante d'une partie (créé une fois, invisible), frère de la partie de base. */
export function ensureOverlay(root: Element, ctx: PlayerContext, part: string, variant: string): SVGElement | null {
  const host = target(root, part);
  if (!host) return null;
  const existing = host.querySelector<SVGElement>(`:scope > [data-slot="${variant}"]`);
  if (existing) return existing;
  const file = ctx.poses.parts[part]?.variants[variant];
  if (!file) return null;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-slot", variant);
  g.style.opacity = "0";
  g.innerHTML = prefixIds(ctx.svgInner(file), `ov${++uid}`);
  host.appendChild(g);
  return g;
}

function baseSlot(root: Element, part: string): SVGElement | null {
  return target(root, part)?.querySelector<SVGElement>(':scope > [data-slot="base"]') ?? null;
}

/** Variante de la partie visible dans l'état courant. */
function currentVariant(root: Element, part: string): string | null {
  return target(root, part)?.getAttribute("data-variant") ?? null;
}

/**
 * Tient une expression (par exemple la bouche ouverte quand un aliment approche) ; `null` rend la
 * variante de l'état. Style direct, pas une animation.
 */
export function holdVariant(root: Element, ctx: PlayerContext, part: string, variant: string | null): void {
  const host = target(root, part);
  const base = baseSlot(root, part);
  if (!host || !base) return;
  const wanted = variant !== null && variant !== currentVariant(root, part) ? ensureOverlay(root, ctx, part, variant) : null;
  host.querySelectorAll<SVGElement>(":scope > [data-slot]").forEach((slot) => {
    if (slot === base) return;
    slot.style.opacity = slot === wanted ? "1" : "0";
  });
  base.style.opacity = wanted ? "0" : "";
}

/** Mouvement d'ensemble tenu par le geste (suivi de la caresse) : groupe `touch`, style direct. */
export function setLean(root: Element, ctx: PlayerContext, v: PoseTransform | null): void {
  const el = target(root, "touch");
  const origin = originOf(ctx, "touch");
  if (!el || !origin) return;
  setOrigin(el, origin);
  el.style.transform = v ? transformString(v) : "";
}

/** Regard tenu par le geste : groupe `gaze`, style direct. */
export function setGaze(root: Element, ctx: PlayerContext, v: Vec2 | null): void {
  const el = target(root, "gaze");
  const origin = originOf(ctx, "gaze");
  if (!el || !origin) return;
  setOrigin(el, origin);
  el.style.transform = v ? transformString({ translate: v }) : "";
}

/** Taches et poussières : opacité tenue (1 = visibles), `null` rend l'état d'origine. */
export function setStains(root: Element, opacity: number | null): void {
  for (const part of ["dust-stains", "dust-specks"]) {
    const el = baseSlot(root, part);
    if (el) el.style.opacity = opacity === null ? "" : String(Math.max(0, Math.min(1, opacity)));
  }
}

export function playReaction(
  root: SVGSVGElement,
  id: string,
  def: StateDef,
  ctx: PlayerContext,
  reduced: boolean,
): ReactionHandle | null {
  const reaction = ctx.reactions.reactions[id];
  if (!reaction) return null;
  const plan = planReaction(reaction, ctx.reactions.props, reduced, { groups: ctx.reactions.groups, kind: ctx.kind });
  const anims: Animation[] = [];
  const created: Element[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const loop: Loop = { id, duration: plan.duration, iterations: 1, easing: plan.easing, targets: {} };
  const opts = (fill: FillMode): KeyframeAnimationOptions => ({ duration: plan.duration, easing: "linear", fill });

  // Parties, groupes et accessoires : transformations et opacité.
  for (const track of plan.tracks) {
    const isProp = ctx.reactions.props[track.target] !== undefined;
    const el = isProp ? createProp(root, ctx, track.target) : target(root, track.target);
    if (!el) continue;
    if (isProp) created.push(el);
    const origin = originOf(ctx, track.target);
    if (origin) setOrigin(el, origin);
    // Écarts (groupes additifs) : ajoutés à la pose et aux boucles, donc sans repli sur la pose statique.
    const base = isProp || track.additive ? {} : (def.static[track.target] ?? {});
    const frames = buildKeyframes(loop, track.frames, base, ctx.poses.easings);
    anims.push(el.animate(frames, { ...opts(isProp ? "both" : "none"), ...(track.additive ? { composite: "add" as const } : {}) }));
  }

  // Expressions : la partie de base se masque, la variante apparaît, dans les fenêtres du plan.
  const byPart = new Map<string, (readonly [number, number])[]>();
  for (const s of plan.swaps) {
    if (s.variant === currentVariant(root, s.part)) continue;
    byPart.set(s.part, [...(byPart.get(s.part) ?? []), ...s.windows]);
  }
  for (const s of plan.swaps) {
    if (s.variant === currentVariant(root, s.part)) continue;
    const overlay = ensureOverlay(root, ctx, s.part, s.variant);
    if (overlay) anims.push(overlay.animate(windowOpacityFrames(s.windows, true), opts("none")));
  }
  for (const [part, windows] of byPart) {
    const base = baseSlot(root, part);
    if (base) anims.push(base.animate(windowOpacityFrames(windows, false), opts("none")));
  }

  if (!reduced) {
    for (const c of plan.particles) {
      timers.push(
        setTimeout(
          () =>
            burstChannel.emit({
              preset: c.preset,
              ...(c.count !== undefined ? { count: c.count } : {}),
              ...(c.emitDuration !== undefined ? { emitDuration: c.emitDuration } : {}),
            }),
          c.at * plan.duration,
        ),
      );
    }
  }

  const cleanup = (): void => {
    timers.forEach(clearTimeout);
    created.forEach((e) => e.remove());
  };
  const finished = Promise.all(anims.map((a) => a.finished)).then(cleanup, cleanup);
  return {
    cancel: () => {
      anims.forEach((a) => a.cancel());
      cleanup();
    },
    finished,
  };
}
