// Créature : parties SVG composées selon spec/motion/poses/<espèce>.json pour l'état principal de
// `deriveView`, emblème dans sa bulle, jusqu'à deux emblèmes secondaires (D4). Interprète de poses : ./motion.ts.
//
// Espèces (D6) : `view.kind` choisit les parties (assets/creature/<espèce>/baby) et les poses de l'espèce.
// L'œuf est commun aux deux : dessin provisoire (./egg.ts) sur les parties de base de kawaii ; l'espèce se
// découvre à l'éclosion, par une petite séquence de lumière (réaction `hatch-<espèce>`).
//
// Stades : seul le stade bébé est dessiné. Pour « child », « teen » et « adult » on réutilise les parties
// du bébé en attendant les dessins suivants (oreilles, queue, ailes : D4).
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Kind as Species, Need, PrimaryState, Stage, View } from "@tamagoshi/rules";
import { useReducedMotion } from "../motion/MotionContext";
import { getCreatureControl, requestReaction, setCreatureControl } from "./control";
import { particles, posesFor, reactions, svgInner } from "./data";
import { EGG_MARKUP, EGG_ORIGINS, EGG_STATE } from "./egg";
import { burstChannel, careChannel, continuousChannel, setAnchorGetter } from "./effects";
import { POSE_OFFSET_Y, VIEW_H } from "./geometry";
import { easingString, playState } from "./motion";
import { holdVariant, playReaction, setGaze, setLean, setStains } from "./reactionPlayer";
import type { PlayerContext, ReactionHandle } from "./reactionPlayer";
import { layerParts } from "./parts";
import { hatchReaction } from "./reactions";
import { prefixIds } from "./svgParts";
import type { StateDef } from "./types";

export interface CreatureProps {
  name: string;
  stage: Stage;
  /** Sortie de `deriveView` (priorité des états de D4 déjà appliquée). */
  view: View;
  /** Libellé écrit de l'état principal, ex. « Lumi a faim ». */
  stateLabel: string;
  /** Libellé des états secondaires, ou null. */
  secondaryLabel?: string | null;
  /** Légende visible sous la créature (désactivée après l'Envol : le titre la remplace). */
  caption?: boolean;
  /** Envol : jouer la séquence (sinon on montre directement l'image finale). */
  playFlight?: boolean;
}

/** Vue de repos, pour l'œuf de l'écran de création. */
export const RESTING_VIEW: View = {
  kind: "kawaii",
  primary: "happy",
  secondary: [],
  gaugeLevels: { satiety: "ok", happiness: "ok", energy: "ok", hygiene: "ok", health: "ok" },
};

const STAGE_LABEL: Record<Stage, string> = {
  egg: "œuf",
  baby: "bébé",
  child: "enfant",
  teen: "adolescent",
  adult: "adulte",
};

/** Emblème des besoins secondaires (l'hygiène et la joie n'en ont pas : le libellé texte les dit). */
const NEED_EMBLEM: Partial<Record<Need, string>> = {
  satiety: "starfruit",
  energy: "candle",
  sick: "raincloud",
  weak: "fading-star",
};

/** Poses communes aux deux espèces : œuf, emblèmes, courbes, transitions (identiques dans les deux fichiers). */
const COMMON = posesFor("kawaii");

function playerContext(species: Species): PlayerContext {
  return { kind: species, poses: posesFor(species), reactions, svgInner };
}

/** « Kind » local : un état de pose, ou l'œuf. L'espèce (kawaii, féérique) est le type `Species`. */
type Kind = PrimaryState | "egg";

/** L'œuf est commun : il se dessine toujours avec les parties de kawaii. */
function speciesOf(kind: Kind, species: Species): Species {
  return kind === "egg" ? "kawaii" : species;
}

function stateOf(kind: Kind, species: Species): StateDef {
  if (kind === "egg") return EGG_STATE;
  const s = posesFor(species).states[kind];
  if (!s) throw new Error(`état de pose inconnu : ${species}/${kind}`);
  return s;
}

/** Contenu SVG d'une couche : toutes les parties visibles, dans l'ordre de `layers`, et l'emblème. */
function layerMarkup(kind: Kind, species: Species, prefix: string): string {
  const poses = posesFor(species);
  const def = stateOf(kind, species);
  const flash =
    `<defs><radialGradient id="${prefix}-flash" cx="120" cy="138" r="100" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#FFD27A" stop-opacity=".85"/><stop offset=".6" stop-color="#FFD27A" stop-opacity=".3"/>` +
    `<stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>` +
    `<circle data-flash="true" cx="120" cy="138" r="100" fill="url(#${prefix}-flash)" opacity="0"/>`;
  let body = "";
  let gazeOpen = false;
  for (const { part, variant, file } of layerParts(poses, def)) {
    // Les deux yeux sont enveloppés dans `gaze` (regard) ; chaque partie a une fente `base` que les
    // réactions masquent le temps d'une expression (reactionPlayer.ts).
    if (part === "eye-left") {
      body += '<g data-target="gaze">';
      gazeOpen = true;
    }
    body +=
      `<g data-target="${part}" data-part="${part}" data-variant="${variant}"><g data-slot="base">` +
      prefixIds(svgInner(file), `${prefix}-${part}-${variant}`) +
      "</g></g>";
    if (part === "eye-right" && gazeOpen) {
      body += "</g>";
      gazeOpen = false;
    }
    if (part === "halo") body += flash;
    if (part === "halo" && kind === "egg") {
      body += `<g data-target="egg">${prefixIds(EGG_MARKUP, `${prefix}-egg`)}</g>`;
    }
  }
  if (gazeOpen) body += "</g>";
  let out = `<g transform="translate(0 ${POSE_OFFSET_Y})"><g data-target="touch"><g data-target="creature"><g data-target="pose">${body}</g></g></g></g>`;
  const emblem = def.emblem ? poses.emblems[def.emblem] : undefined;
  if (emblem) {
    out +=
      `<g transform="translate(88 2)"><g data-target="emblem">` +
      prefixIds(svgInner(emblem.bubble), `${prefix}-bub`) +
      prefixIds(svgInner(emblem.file), `${prefix}-emb`) +
      "</g></g>";
  }
  return out;
}

interface LayerProps {
  id: number;
  kind: Kind;
  species: Species;
  fadeIn: boolean;
  playSequence: boolean;
  reduced: boolean;
  onShown: (id: number) => void;
}

/** Une couche = une créature complète dans un état. Un changement d'état empile une nouvelle couche. */
const CreatureLayer = memo(function CreatureLayer({ id, kind, species, fadeIn, playSequence, reduced, onShown }: LayerProps) {
  const ref = useRef<SVGSVGElement>(null);
  const markup = useMemo(() => layerMarkup(kind, species, `c${id}`), [kind, species, id]);

  // Fondu d'entrée : la nouvelle couche apparaît par-dessus l'ancienne (qui reste opaque dessous).
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !fadeIn) return;
    const t = reduced ? COMMON.reducedMotion.transition : COMMON.transition;
    const a = svg.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: t.duration,
      easing: easingString(COMMON.easings, t.easing),
      fill: "backwards",
    });
    const done = (): void => onShown(id);
    a.addEventListener("finish", done);
    return () => {
      a.removeEventListener("finish", done);
      a.cancel();
    };
    // Une seule fois par couche : un changement de mouvement réduit en cours de route ne la rejoue pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poses et boucles.
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const poses = posesFor(species);
    const def = stateOf(kind, species);
    const handle = playState(svg, def, {
      spec: poses,
      reduced,
      settled: !playSequence,
      origins: EGG_ORIGINS,
      rest: poses.rest,
    });
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!reduced && playSequence && def.sequence) {
      for (const p of def.particles) {
        if (p.at === undefined) continue;
        timers.push(setTimeout(() => burstChannel.emit({ preset: p.preset }), p.at * def.sequence.duration));
      }
    }
    return () => {
      timers.forEach(clearTimeout);
      handle.cancel();
    };
  }, [kind, species, reduced, playSequence]);

  // Retour lumineux : le halo s'intensifie (opacité seule), jamais en mouvement réduit.
  useEffect(() => {
    if (reduced) return;
    return careChannel.on(() => {
      const flash = ref.current?.querySelector<SVGElement>("[data-flash]");
      flash?.animate([{ opacity: 0 }, { opacity: 0.8, offset: 0.35 }, { opacity: 0 }], {
        duration: 1100,
        easing: "ease-out",
      });
    });
  }, [reduced]);

  return (
    <svg
      ref={ref}
      className="creature-layer"
      data-layer={id}
      viewBox={`0 0 240 ${VIEW_H}`}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});

/** Emblèmes secondaires, petits, de part et d'autre de la bulle principale. Décoratifs : le libellé les dit. */
function SecondaryEmblems({ ids, hasMain, reduced }: { ids: readonly string[]; hasMain: boolean; reduced: boolean }) {
  // Avec une bulle principale : une de chaque côté. Sans : centrés au-dessus de la tête.
  const slots: readonly number[] = hasMain ? [48, 160] : ids.length === 1 ? [104] : [72, 136];
  return (
    <svg className="creature-layer" viewBox={`0 0 240 ${VIEW_H}`} aria-hidden="true" focusable="false">
      {ids.map((id, i) => (
        <SecondaryEmblem key={id} id={id} x={slots[i] ?? 104} reduced={reduced} />
      ))}
    </svg>
  );
}

function SecondaryEmblem({ id, x, reduced }: { id: string; x: number; reduced: boolean }) {
  const ref = useRef<SVGGElement>(null);
  const def = COMMON.emblems[id];
  const markup = useMemo(
    () =>
      def
        ? prefixIds(svgInner(def.bubble), `s-${id}-bub`) + prefixIds(svgInner(def.file), `s-${id}-emb`)
        : "",
    [def, id],
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t = reduced ? COMMON.reducedMotion.transition : COMMON.transition;
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: t.duration,
      easing: easingString(COMMON.easings, t.easing),
      fill: "backwards",
    });
    return () => a.cancel();
  }, [reduced]);
  if (!def) return null;
  return (
    <g ref={ref}>
      <g transform={`translate(${x} 22) scale(0.5)`} dangerouslySetInnerHTML={{ __html: markup }} />
    </g>
  );
}

/** Clairière flottante : coussin de brume et mousse ronde (couleurs du ciel courant). */
function Clearing({ reduced }: { reduced: boolean }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const breath = easingString(COMMON.easings, "breath");
    const a = el.animate(
      [
        { transform: "translateY(0px)", easing: breath },
        { transform: "translateY(-3px)", easing: breath },
        { transform: "translateY(0px)" },
      ],
      { duration: 7200, iterations: Infinity },
    );
    return () => a.cancel();
  }, [reduced]);
  return (
    <svg className="creature-layer" viewBox={`0 0 240 ${VIEW_H}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="clr-mist" cx=".5" cy=".5" r=".5">
          <stop offset="0" style={{ stopColor: "var(--mist)", stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: "var(--mist)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="clr-moss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--moss-1)" }} />
          <stop offset="1" style={{ stopColor: "var(--moss-2)" }} />
        </linearGradient>
      </defs>
      <g ref={ref}>
        <ellipse cx="120" cy="276" rx="120" ry="34" fill="url(#clr-mist)" />
        <ellipse cx="120" cy="270" rx="100" ry="24" fill="url(#clr-moss)" stroke="#FFFFFF" strokeOpacity=".35" />
        <ellipse cx="86" cy="266" rx="14" ry="4" fill="#FFFFFF" fillOpacity=".14" />
        <ellipse cx="160" cy="274" rx="18" ry="4.5" fill="#FFFFFF" fillOpacity=".12" />
      </g>
    </svg>
  );
}

interface LayerState {
  id: number;
  kind: Kind;
  species: Species;
  fade: boolean;
}

export function Creature({
  name,
  stage,
  view,
  stateLabel,
  secondaryLabel = null,
  caption = true,
  playFlight = false,
}: CreatureProps) {
  const reduced = useReducedMotion();
  const kind: Kind = stage === "egg" && view.primary !== "flown" ? "egg" : view.primary;
  const species = speciesOf(kind, view.kind);
  const [layers, setLayers] = useState<LayerState[]>(() => [{ id: 0, kind, species, fade: playFlight }]);
  const top = layers[layers.length - 1] as LayerState;
  if (top.kind !== kind || top.species !== species) {
    setLayers((ls) => [...ls, { id: (ls[ls.length - 1] as LayerState).id + 1, kind, species, fade: true }]);
  }
  // Éclosion sous nos yeux (l'œuf devient créature) : l'espèce se découvre par une petite séquence de lumière.
  const [hatched, setHatched] = useState<number | null>(null);
  const hatching = top.kind === "egg" && kind !== "egg" && hatched !== top.id;
  if (hatching) setHatched(top.id);
  const dropOlder = (id: number): void => setLayers((ls) => ls.filter((l) => l.id >= id));

  // Emblèmes secondaires : ceux qui en ont un, sans doublon avec l'emblème principal, deux au plus.
  const mainEmblem = stateOf(kind, species).emblem;
  const secondaryEmblems = view.secondary
    .map((n) => NEED_EMBLEM[n])
    .filter((e): e is string => e !== undefined && e !== mainEmblem)
    .filter((e, i, all) => all.indexOf(e) === i)
    .slice(0, 2);

  // Particules continues de l'état (lucioles, petites lunes) et position de la créature à l'écran.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAnchorGetter(() => {
      const r = stageRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return null;
      const scale = r.width / 240;
      return { x: r.left, y: r.top + POSE_OFFSET_Y * scale, scale };
    });
    return () => setAnchorGetter(null);
  }, []);
  const continuous = useMemo(
    () => stateOf(kind, species).particles.filter((p) => p.continuous).map((p) => p.preset),
    [kind, species],
  );
  // La séquence de lumière se joue une fois la nouvelle couche en place (requestReaction attend le rendu).
  const hatchKey = hatched !== null && kind !== "egg" ? `${hatched}:${species}` : null;
  const hatchPlayed = useRef<string | null>(null);
  useEffect(() => {
    if (hatchKey === null || hatchPlayed.current === hatchKey) return;
    hatchPlayed.current = hatchKey;
    requestReaction(hatchReaction(species));
    careChannel.emit("play");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hatchKey]);
  useEffect(() => {
    continuousChannel.emit(continuous);
    return () => continuousChannel.emit([]);
  }, [continuous]);

  // Poignée de commande pour les réactions et les gestes : toujours sur la couche du dessus.
  const topRef = useRef({ kind, species });
  topRef.current = {
    kind: (layers[layers.length - 1] as LayerState).kind,
    species: (layers[layers.length - 1] as LayerState).species,
  };
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  useEffect(() => {
    let handle: ReactionHandle | null = null;
    const topSvg = (): SVGSVGElement | null => {
      const all = stageRef.current?.querySelectorAll<SVGSVGElement>("svg[data-layer]");
      if (!all || all.length === 0) return null;
      let best: SVGSVGElement | null = null;
      all.forEach((el) => {
        if (!best || Number(el.dataset["layer"]) > Number(best.dataset["layer"])) best = el;
      });
      return best;
    };
    setCreatureControl({
      play: (id) => {
        const svg = topSvg();
        if (!svg) return;
        handle?.cancel();
        const top = topRef.current;
        handle = playReaction(svg, id, stateOf(top.kind, top.species), playerContext(top.species), reducedRef.current);
      },
      lean: (v) => {
        const svg = topSvg();
        if (svg) setLean(svg, playerContext(topRef.current.species), v);
      },
      gaze: (v) => {
        const svg = topSvg();
        if (svg) setGaze(svg, playerContext(topRef.current.species), v ? [v.x, v.y] : null);
      },
      hold: (part, variant) => {
        const svg = topSvg();
        if (svg) holdVariant(svg, playerContext(topRef.current.species), part, variant);
      },
      stains: (o) => {
        const svg = topSvg();
        if (svg) setStains(svg, o);
      },
      rect: () => {
        const r = stageRef.current?.getBoundingClientRect();
        return r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      },
    });
    return () => {
      handle?.cancel();
      if (getCreatureControl()) setCreatureControl(null);
    };
  }, []);

  // Contrôle : les préréglages cités doivent exister (données de spec/).
  if (import.meta.env.DEV) {
    for (const id of continuous) if (!particles.presets[id]) console.warn(`préréglage de particules inconnu : ${id}`);
  }

  return (
    <figure
      className="creature"
      data-stage={stage}
      data-kind={species}
      data-state={view.primary}
      aria-label={`${name}, ${STAGE_LABEL[stage]}. ${stateLabel}.`}
    >
      <div className="creature-stage" ref={stageRef} aria-hidden="true">
        <Clearing reduced={reduced} />
        {layers.map((l) => (
          <CreatureLayer
            key={l.id}
            id={l.id}
            kind={l.kind}
            species={l.species}
            fadeIn={l.fade}
            playSequence={playFlight}
            reduced={reduced}
            onShown={dropOlder}
          />
        ))}
        <SecondaryEmblems ids={secondaryEmblems} hasMain={mainEmblem !== null} reduced={reduced} />
      </div>
      {caption && (
        <figcaption className="creature-caption">
          <strong>{stateLabel}</strong>
          <span className="creature-stage-label">stade : {STAGE_LABEL[stage]}</span>
          {secondaryLabel && <span className="creature-secondary">{secondaryLabel}</span>}
        </figcaption>
      )}
    </figure>
  );
}
