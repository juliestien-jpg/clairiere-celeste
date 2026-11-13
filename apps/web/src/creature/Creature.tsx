// Créature : parties SVG composées selon spec/motion/poses/<espèce>.json pour l'état principal de
// `deriveView`, emblème dans sa bulle, jusqu'à deux emblèmes secondaires (D4). Interprète de poses : ./motion.ts.
//
// Espèces et stades (D6) : `view.kind` et le stade choisissent les parties (assets/creature/<espèce>/<stade>) et
// les poses (spec/motion/poses/<espèce>.json, `stages`). Un changement de stade se fond comme un changement d'état.
//
// L'œuf est commun aux deux espèces (assets/creature/egg, poses/egg.json) : `idle`, puis `soon` quand l'éclosion
// approche (./egg.ts). Quand le stade passe de l'œuf au bébé sous les yeux du joueur, la séquence `hatch` se joue
// (3 s) et, au `handoff` de la séquence, la créature de l'espèce tirée apparaît : l'espèce se découvre.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Kind as Species, Need, PrimaryState, Stage, View } from "@tamagoshi/rules";
import { useReducedMotion } from "../motion/MotionContext";
import { getCreatureControl, requestReaction, setCreatureControl } from "./control";
import { particles, posesFor, reactions, svgInner } from "./data";
import { eggState } from "./egg";
import { burstChannel, careChannel, continuousChannel, setAnchorGetter } from "./effects";
import { POSE_OFFSET_Y, VIEW_H, setDisplayedStage } from "./geometry";
import { easingString, playState } from "./motion";
import { holdVariant, playReaction, setGaze, setLean, setStains } from "./reactionPlayer";
import type { PlayerContext, ReactionHandle } from "./reactionPlayer";
import { layerParts, resolvePreset } from "./parts";
import { hatchReaction } from "./reactions";
import { prefixIds } from "./svgParts";
import type { PosesSpec, StateDef } from "./types";

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
  /**
   * Œuf seulement : avancement vers l'éclosion de 0 à 1 (`hatchProgress` de ./egg.ts). À partir de `SOON_FROM`
   * l'œuf montre ses fissures dorées (`soon`). Absent : l'œuf reste calme (`idle`).
   */
  hatchProgress?: number;
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

function playerContext(species: Species, stage: Stage): PlayerContext {
  return { kind: species, poses: posesFor(species, stage), reactions, svgInner };
}

/**
 * Ce qui s'affiche : un stade, un état de ses poses (`PrimaryState` ; pour l'œuf `idle`, `soon` ou `hatch`) et
 * l'espèce. Un changement d'une de ces trois valeurs empile une nouvelle couche (fondu).
 */
interface Look {
  stage: Stage;
  state: PrimaryState | EggLook;
  species: Species;
}
type EggLook = "idle" | "soon" | "hatch";

/** Stade dessiné : un œuf envolé (sauvegarde étrangère) se montre avec les poses du bébé, qui ont l'Envol. */
function drawStageOf(stage: Stage, primary: PrimaryState): Stage {
  return stage === "egg" && primary === "flown" ? "baby" : stage;
}

function sameLook(a: Look, b: Look): boolean {
  // L'œuf est commun aux deux espèces : changer d'espèce de l'œuf ne le redessine pas.
  return a.stage === b.stage && a.state === b.state && (a.stage === "egg" || a.species === b.species);
}

function stateOf(look: Look): StateDef {
  const s = posesFor(look.species, look.stage).states[look.state];
  if (!s) throw new Error(`état de pose inconnu : ${look.species}/${look.stage}/${look.state}`);
  return s;
}

/** Contenu SVG d'une couche : toutes les parties visibles, dans l'ordre de `layers`, et l'emblème. */
function layerMarkup(look: Look, prefix: string): string {
  const poses = posesFor(look.species, look.stage);
  const def = stateOf(look);
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
    if (part === "halo" || (look.stage === "egg" && part === "glow")) body += flash;
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
  look: Look;
  fadeIn: boolean;
  playSequence: boolean;
  reduced: boolean;
  onShown: (id: number) => void;
}

/** Une couche = une créature complète dans un état. Un changement d'état empile une nouvelle couche. */
const CreatureLayer = memo(function CreatureLayer({ id, look, fadeIn, playSequence, reduced, onShown }: LayerProps) {
  const ref = useRef<SVGSVGElement>(null);
  const { stage, state, species } = look;
  const markup = useMemo(() => layerMarkup({ stage, state, species }, `c${id}`), [stage, state, species, id]);

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
    const poses: PosesSpec = posesFor(species, stage);
    const def = stateOf({ stage, state, species });
    const handle = playState(svg, def, {
      spec: poses,
      reduced,
      settled: !playSequence,
      rest: poses.rest,
    });
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!reduced && playSequence && def.sequence) {
      for (const p of def.particles) {
        if (p.at === undefined) continue;
        timers.push(
          setTimeout(() => burstChannel.emit({ preset: resolvePreset(p.preset, species) }), p.at * def.sequence.duration),
        );
      }
    }
    return () => {
      timers.forEach(clearTimeout);
      handle.cancel();
    };
  }, [stage, state, species, reduced, playSequence]);

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
  look: Look;
  fade: boolean;
  /** Première couche de la créature après l'éclosion : la réaction `hatch-<espèce>` s'y joue. */
  reveal?: boolean;
}

export function Creature({
  name,
  stage,
  view,
  stateLabel,
  secondaryLabel = null,
  caption = true,
  playFlight = false,
  hatchProgress,
}: CreatureProps) {
  const reduced = useReducedMotion();
  const drawStage = drawStageOf(stage, view.primary);
  const desired: Look = {
    stage: drawStage,
    state: drawStage === "egg" ? eggState(hatchProgress) : view.primary,
    species: view.kind,
  };
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  const [layers, setLayers] = useState<LayerState[]>(() => [{ id: 0, look: desired, fade: playFlight }]);
  const top = layers[layers.length - 1] as LayerState;
  const leavingEgg = top.look.stage === "egg" && desired.stage !== "egg";
  if (!sameLook(top.look, desired) && !(top.look.state === "hatch" && desired.stage !== "egg")) {
    // L'œuf qui devient créature sous nos yeux éclôt d'abord (mouvement réduit : simple fondu vers le bébé).
    const hatch = leavingEgg && !reduced;
    const next: LayerState = {
      id: top.id + 1,
      look: hatch ? { stage: "egg", state: "hatch", species: view.kind } : desired,
      fade: true,
      reveal: leavingEgg && !hatch,
    };
    setLayers((ls) => [...ls, next]);
  }
  const dropOlder = (id: number): void => setLayers((ls) => ls.filter((l) => l.id >= id));

  // Handoff de la séquence d'éclosion : à cet instant la créature de l'espèce tirée prend la place de l'œuf.
  const hatchId = top.look.state === "hatch" ? top.id : null;
  useEffect(() => {
    if (hatchId === null) return;
    const def = posesFor("kawaii", "egg").states["hatch"];
    const at = reduced ? 0 : (def?.handoff?.at ?? 0.6) * (def?.sequence?.duration ?? 3000);
    const timer = setTimeout(() => {
      setLayers((ls) => {
        const last = ls[ls.length - 1] as LayerState;
        if (last.id !== hatchId) return ls;
        return [...ls, { id: last.id + 1, look: desiredRef.current, fade: true, reveal: true }];
      });
    }, at);
    return () => clearTimeout(timer);
  }, [hatchId, reduced]);

  // Le stade affiché règle les zones de geste (tête, bouche, silhouette).
  useEffect(() => {
    setDisplayedStage(drawStage);
  }, [drawStage]);

  // Emblèmes secondaires : ceux qui en ont un, sans doublon avec l'emblème principal, deux au plus.
  const mainEmblem = stateOf(top.look).emblem;
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
    () => stateOf(desired).particles.filter((p) => p.continuous).map((p) => p.preset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desired.stage, desired.state, desired.species],
  );
  // La créature se révèle (fin de l'éclosion) : la séquence de lumière de son espèce se joue une fois la
  // nouvelle couche en place (requestReaction attend le rendu).
  const revealId = top.reveal ? top.id : null;
  const revealSpecies = top.look.species;
  useEffect(() => {
    if (revealId === null) return;
    requestReaction(hatchReaction(revealSpecies));
    careChannel.emit("play");
  }, [revealId, revealSpecies]);
  useEffect(() => {
    continuousChannel.emit(continuous);
    return () => continuousChannel.emit([]);
  }, [continuous]);

  // Poignée de commande pour les réactions et les gestes : toujours sur la couche du dessus.
  const topRef = useRef(top.look);
  topRef.current = top.look;
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
        handle = playReaction(svg, id, stateOf(top), playerContext(top.species, top.stage), reducedRef.current);
      },
      lean: (v) => {
        const svg = topSvg();
        if (svg) setLean(svg, playerContext(topRef.current.species, topRef.current.stage), v);
      },
      gaze: (v) => {
        const svg = topSvg();
        if (svg) setGaze(svg, playerContext(topRef.current.species, topRef.current.stage), v ? [v.x, v.y] : null);
      },
      hold: (part, variant) => {
        const svg = topSvg();
        if (svg) holdVariant(svg, playerContext(topRef.current.species, topRef.current.stage), part, variant);
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
      data-kind={view.kind}
      data-state={view.primary}
      aria-label={`${name}, ${STAGE_LABEL[stage]}. ${stateLabel}.`}
    >
      <div className="creature-stage" ref={stageRef} aria-hidden="true">
        <Clearing reduced={reduced} />
        {layers.map((l) => (
          <CreatureLayer
            key={l.id}
            id={l.id}
            look={l.look}
            fadeIn={l.fade}
            playSequence={playFlight || l.look.state === "hatch"}
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
