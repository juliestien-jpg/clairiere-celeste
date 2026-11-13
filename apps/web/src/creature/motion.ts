// Interprète de poses (D4) : API Web Animations, uniquement `transform` et `opacity`.
// Vocabulaire : translate, rotate, scale, opacity, boucles, courbes nommées. Rien d'autre.
import type { Keyframe as PoseKeyframe, Loop, PoseTransform, PosesSpec, Sequence, StateDef, Vec2 } from "./types";

// --- Fonctions pures (testées) --------------------------------------------------------------------

/** Ordre de composition de la spec : translate, puis rotate, puis scale. */
export function transformString(v: PoseTransform | undefined): string {
  const t = v?.translate ?? [0, 0];
  const r = v?.rotate ?? 0;
  const s = v?.scale ?? 1;
  const [sx, sy] = typeof s === "number" ? [s, s] : s;
  return `translate(${t[0]}px, ${t[1]}px) rotate(${r}deg) scale(${sx}, ${sy})`;
}

export function easingString(easings: PosesSpec["easings"], name: string | undefined): string {
  const c = easings[name ?? "linear"] ?? easings["linear"] ?? [0, 0, 1, 1];
  return `cubic-bezier(${c.join(",")})`;
}

/**
 * Images clés Web Animations d'une cible. Une propriété absente reprend la valeur de `base`
 * (la pose statique de la cible), sinon l'identité. Si une image clé fixe l'opacité, toutes la fixent.
 */
export function buildKeyframes(
  loop: Loop,
  frames: readonly PoseKeyframe[],
  base: PoseTransform,
  easings: PosesSpec["easings"],
): PlainFrame[] {
  const hasOpacity = frames.some((k) => k.opacity !== undefined);
  return frames.map((k) => {
    const f: PlainFrame = {
      offset: k.offset,
      transform: transformString({
        translate: k.translate ?? base.translate,
        rotate: k.rotate ?? base.rotate,
        scale: k.scale ?? base.scale,
      }),
      easing: easingString(easings, k.easing ?? loop.easing),
    };
    if (hasOpacity) f.opacity = k.opacity ?? base.opacity ?? 1;
    return f;
  });
}

/** Image clé au format Web Animations. */
export type PlainFrame = {
  offset: number;
  transform: string;
  easing: string;
  opacity?: number;
};

// --- Interprète (DOM) -----------------------------------------------------------------------------

export interface MotionOptions {
  spec: PosesSpec;
  /** Mouvement réduit : seulement la pose statique ; Envol figé à `reducedAt`. */
  reduced: boolean;
  /** Envol déjà joué : va directement à la dernière image puis boucle d'après. */
  settled?: boolean;
  /** Origines supplémentaires (cibles qui ne sont ni dans `targets` ni dans `parts`). */
  origins?: Record<string, Vec2>;
  /** Boucle de repos par défaut, remplaçable par l'état. */
  rest?: Loop;
}

export interface MotionHandle {
  /** Arrête tout ; les styles statiques restent. */
  cancel(): void;
  /** Résolue quand la séquence (Envol) est terminée. */
  sequenceDone: Promise<void>;
}

function findTarget(root: Element, name: string): SVGElement | null {
  return root.querySelector<SVGElement>(`[data-target="${name}"]`);
}

function originOf(spec: PosesSpec, extra: Record<string, Vec2> | undefined, name: string): Vec2 | null {
  return extra?.[name] ?? spec.targets[name]?.origin ?? spec.parts[name]?.origin ?? null;
}

export function playState(root: Element, def: StateDef, opts: MotionOptions): MotionHandle {
  const { spec, reduced } = opts;
  const anims: Animation[] = [];
  let cancelled = false;
  let resolveDone: () => void = () => undefined;
  const sequenceDone = new Promise<void>((r) => (resolveDone = r));

  // 1. Pose statique : seule chose qui reste en mouvement réduit.
  const names = new Set<string>(Object.keys(def.static));
  const collect = (l: Loop): void => Object.keys(l.targets).forEach((n) => names.add(n));
  const rest = def.rest === undefined ? opts.rest : def.rest;
  if (rest) collect(rest);
  def.loops.forEach(collect);
  if (def.sequence) collect(def.sequence);
  def.after?.loops.forEach(collect);
  for (const name of names) {
    const el = findTarget(root, name);
    const origin = originOf(spec, opts.origins, name);
    if (!el || !origin) continue;
    el.style.transformBox = "view-box";
    el.style.transformOrigin = `${origin[0]}px ${origin[1]}px`;
    const st = def.static[name];
    el.style.transform = st ? transformString(st) : "";
    el.style.opacity = st?.opacity !== undefined ? String(st.opacity) : "";
  }

  const run = (loop: Loop, extra?: KeyframeAnimationOptions): Animation | null => {
    let first: Animation | null = null;
    for (const [name, frames] of Object.entries(loop.targets)) {
      const el = findTarget(root, name);
      if (!el) continue;
      const kf = buildKeyframes(loop, frames, def.static[name] ?? {}, spec.easings);
      const a = el.animate(kf, {
        duration: loop.duration,
        iterations: loop.iterations === "infinite" ? Infinity : loop.iterations,
        easing: "linear", // les courbes sont par segment, dans les images clés
        fill: loop.fill ?? "none",
        delay: loop.delay ?? 0,
        ...extra,
      });
      anims.push(a);
      first ??= a;
    }
    return first;
  };

  if (reduced) {
    if (def.sequence) {
      // Image figée de l'Envol (`reducedAt`).
      const seq: Sequence = def.sequence;
      run(seq, { fill: "both" });
      for (const a of anims) {
        a.pause();
        a.currentTime = seq.reducedAt * seq.duration;
      }
    }
    resolveDone();
    return { cancel: () => anims.forEach((a) => a.cancel()), sequenceDone };
  }

  const startLoops = (loops: readonly Loop[]): void => {
    if (cancelled) return;
    loops.forEach((l) => run(l));
  };

  if (rest) run(rest);
  startLoops(def.loops);

  if (def.sequence) {
    const first = run(def.sequence);
    const after = def.after?.loops ?? [];
    if (first && opts.settled) {
      for (const a of anims) a.finish();
      startLoops(after);
      resolveDone();
    } else if (first) {
      void first.finished.then(
        () => {
          startLoops(after);
          resolveDone();
        },
        () => undefined, // annulée
      );
    } else {
      resolveDone();
    }
  } else {
    resolveDone();
  }

  return {
    cancel: () => {
      cancelled = true;
      anims.forEach((a) => a.cancel());
    },
    sequenceDone,
  };
}
