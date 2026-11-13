// Zone de jeu : la créature, son plateau d'objets et les gestes directs (Pointer Events, tactile d'abord,
// souris aussi). `touch-action: none` ne s'applique qu'à cette zone (voir styles.css) : le reste de la page
// défile normalement. Chaque geste a son équivalent en un seul clic : les boutons d'action et les objets du
// plateau (touche, Entrée ou clic) déclenchent la même action et la même réaction animée (critère 2.5.7).
// La reconnaissance des gestes et tous les seuils vivent dans ../gestures/recognizers.ts.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Action, Kind } from "@tamagoshi/rules";
import { getCreatureControl, requestReaction } from "../creature/control";
import { svgInner } from "../creature/data";
import { burstChannel } from "../creature/effects";
import { clientToUnits, geometryFor, insideBody, unitsToClient } from "../creature/geometry";
import type { Pt, StageRect } from "../creature/geometry";
import { prefixIds } from "../creature/svgParts";
import { useReducedMotion } from "../motion/MotionContext";
import { haptic } from "../gestures/haptics";
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
} from "../gestures/recognizers";
import type { DragState, DragTarget, Sample, Velocity } from "../gestures/recognizers";
import type { ActionHandler, PerformOptions } from "./perform";

type ItemId = "meal" | "snack" | "heal" | "star" | "sponge";

interface ItemDef {
  id: ItemId;
  label: string;
  file: string;
  target: DragTarget;
  action: Action | null;
  aria: string;
}

const ITEMS: readonly ItemDef[] = [
  { id: "meal", label: "Repas", file: "props/bowl.svg", target: "mouth", action: { type: "feed", food: "meal" }, aria: "Repas : glisser jusqu'à la bouche, ou appuyer pour nourrir" },
  { id: "snack", label: "Goûter", file: "props/snack-fruit.svg", target: "mouth", action: { type: "feed", food: "snack" }, aria: "Goûter : glisser jusqu'à la bouche, ou appuyer pour donner un goûter" },
  { id: "heal", label: "Fiole", file: "props/vial.svg", target: "body", action: { type: "heal" }, aria: "Fiole : glisser jusqu'à la créature, ou appuyer pour soigner" },
  { id: "star", label: "Étoile", file: "props/toy-star.svg", target: "body", action: { type: "play" }, aria: "Étoile : lancer d'une pichenette, ou appuyer pour jouer" },
  { id: "sponge", label: "Éponge", file: "props/sponge.svg", target: "body", action: null, aria: "Éponge de lumière : appuyer pour frotter la créature (le bouton Laver nettoie sans geste)" },
];
const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<ItemId, ItemDef>;

/** Éponge tenue à côté du doigt (pixels), pour ne pas cacher le visage ni le point frotté. */
const SPONGE_OFFSET_TOUCH: Pt = { x: 40, y: 34 };
const SPONGE_OFFSET_MOUSE: Pt = { x: 16, y: 16 };
const THROW_MS = 800;
const RETURN_MS = 220;
const PET_LEAN_PX = 4;
const PET_LEAN_DEG = 5;
const GAZE_UNITS = 3;

interface ItemSession {
  kind: "item";
  item: ItemId;
  pointerId: number;
  pointerType: string;
  start: Pt;
  started: boolean;
  held: Pt;
  samples: Sample[];
  state: DragState | null;
}
interface BodySession {
  kind: "body";
  pointerId: number;
  pointerType: string;
  start: Pt;
  startT: number;
  moved: boolean;
  pet: PetStroke;
  petSent: boolean;
}
type Session = ItemSession | BodySession;

const PropIcon = memo(function PropIcon({ file, idp }: { file: string; idp: string }) {
  const markup = useMemo(() => prefixIds(svgInner(file), idp), [file, idp]);
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: markup }} />
  );
});

/** Capture du pointeur : le geste continue même si le doigt sort de la zone. Sans effet si le navigateur refuse. */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointeur déjà relâché : le geste se termine tout seul.
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Regard vers un point (repère de la créature), quelques unités au plus. */
function gazeToward(u: Pt, eyeY: number): Pt {
  return { x: clamp((u.x - 120) / 40, -1, 1) * GAZE_UNITS, y: clamp((u.y - eyeY) / 40, -1, 1) * (GAZE_UNITS - 1) };
}

export function PlayArea(props: { name: string; kind: Kind; asleep: boolean; onAction: ActionHandler; children: ReactNode }) {
  const { name, kind, asleep, onAction, children } = props;
  const geo = geometryFor(kind);
  const geoRef = useRef({ kind, geo });
  geoRef.current = { kind, geo };
  const reduced = useReducedMotion();
  const areaRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [mode, setModeState] = useState<"wash" | null>(null);
  const [ghost, setGhost] = useState<ItemId | null>(null);

  const modeRef = useRef(mode);
  const sess = useRef<Session | null>(null);
  const scrub = useRef(new ScrubTracker());
  const play = useRef(new PlaySession());
  const ghostPos = useRef<Pt>({ x: -100, y: -100 });
  const mouthOpen = useRef(false);
  const eyesShut = useRef(false);
  const lastBubble = useRef(0);
  const flight = useRef<Animation | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const ctl = (): ReturnType<typeof getCreatureControl> => getCreatureControl();
  const act = (a: Action, o?: PerformOptions): void => actionRef.current(a, o);
  const metrics = (): { rect: StageRect; W: number; mouth: Pt } | null => {
    const rect = ctl()?.rect();
    return rect ? { rect, W: rect.width, mouth: unitsToClient(rect, geoRef.current.geo.mouth) } : null;
  };

  const setMode = useCallback((m: "wash" | null) => {
    modeRef.current = m;
    setModeState(m);
  }, []);

  // --- Ghost (objet tenu, éponge) -------------------------------------------------------------------

  const placeGhost = (p: Pt): void => {
    ghostPos.current = p;
    const g = ghostRef.current;
    if (g) g.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  };
  useLayoutEffect(() => {
    placeGhost(ghostPos.current);
  }, [ghost]);

  const releaseFace = (): void => {
    if (mouthOpen.current) ctl()?.hold("mouth", null);
    mouthOpen.current = false;
    if (eyesShut.current) {
      ctl()?.hold("eye-left", null);
      ctl()?.hold("eye-right", null);
    }
    eyesShut.current = false;
    ctl()?.gaze(null);
  };

  const spongeOffset = (type: string): Pt => (type === "touch" || type === "pen" ? SPONGE_OFFSET_TOUCH : SPONGE_OFFSET_MOUSE);

  // --- Mode laver ---------------------------------------------------------------------------------------

  const exitWash = useCallback(
    (completed = false) => {
      if (modeRef.current !== "wash") return;
      setMode(null);
      setGhost(null);
      const c = getCreatureControl();
      if (!completed) c?.stains(null);
      else setTimeout(() => getCreatureControl()?.stains(null), 1600);
      if (eyesShut.current) {
        c?.hold("eye-left", null);
        c?.hold("eye-right", null);
        eyesShut.current = false;
      }
    },
    [setMode],
  );

  const enterWash = useCallback(() => {
    if (modeRef.current === "wash") return;
    scrub.current = new ScrubTracker();
    lastBubble.current = 0;
    setMode("wash");
    setGhost("sponge");
    const m = getCreatureControl()?.rect();
    if (m) placeGhost(unitsToClient(m, { x: 120, y: 188 }));
  }, [setMode]);

  // Se couche : plus de geste possible, on range tout.
  useEffect(() => {
    if (!asleep) return;
    exitWash();
    sess.current = null;
    setGhost(null);
    releaseFace();
    getCreatureControl()?.lean(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asleep, exitWash]);

  // --- Retour de l'objet sur le plateau -------------------------------------------------------------

  const returnGhost = (item: ItemId): void => {
    const g = ghostRef.current;
    const slot = areaRef.current?.querySelector<HTMLElement>(`[data-item="${item}"] .tray-disc`);
    if (reducedRef.current || !g || !slot) {
      setGhost(null);
      return;
    }
    const r = slot.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const tr = (p: Pt): string => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    const a = g.animate([{ transform: tr(ghostPos.current) }, { transform: tr(to) }], {
      duration: RETURN_MS,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    });
    const done = (): void => setGhost((cur) => (cur === item ? null : cur));
    a.finished.then(done, done);
  };

  // --- Touche : rebond et rire, une partie de jeu ------------------------------------------------

  const touchCreature = (): void => {
    haptic(GESTURE.HAPTIC_MS, reducedRef.current);
    if (play.current.touch(performance.now())) act({ type: "play" }, { reaction: "tap" });
    else requestReaction("tap");
  };

  // --- Étoile lancée -----------------------------------------------------------------------------------

  const catchStar = (): void => {
    flight.current = null;
    setGhost(null);
    ctl()?.gaze(null);
    haptic(GESTURE.HAPTIC_DONE_MS, reducedRef.current);
    if (play.current.caught(performance.now())) act({ type: "play" }, { reaction: "catch" });
    else requestReaction("catch");
  };

  const throwStar = (from: Pt, v: Velocity, m: { rect: StageRect; W: number }): void => {
    const g = ghostRef.current;
    if (reducedRef.current || !g) {
      catchStar();
      return;
    }
    const bounds = {
      left: m.rect.left,
      right: m.rect.left + m.rect.width,
      top: m.rect.top + m.rect.height * 0.1,
      bottom: m.rect.top + m.rect.height * 0.7,
    };
    const apex = throwApex(from, v, m.W, bounds);
    const head = unitsToClient(m.rect, geoRef.current.geo.head);
    const tr = (p: Pt, s: number): string => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
    const a = g.animate(
      [
        { transform: tr(from, 1), easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
        { transform: tr(apex, 1.1), offset: 0.45, easing: "cubic-bezier(0.5, 0, 0.8, 0.5)" },
        { transform: tr(head, 0.7) },
      ],
      { duration: THROW_MS, fill: "forwards" },
    );
    flight.current = a;
    const follow = (): void => {
      if (flight.current !== a) return;
      const r = g.getBoundingClientRect();
      ctl()?.gaze(gazeToward(clientToUnits(m.rect, { x: r.left + r.width / 2, y: r.top + r.height / 2 }), geoRef.current.geo.eyeY));
      requestAnimationFrame(follow);
    };
    follow();
    a.finished.then(
      () => {
        if (flight.current === a) catchStar();
      },
      () => {
        if (flight.current === a) flight.current = null;
      },
    );
  };

  // --- Objets glissés ----------------------------------------------------------------------------------

  const updateItem = (s: ItemSession, p: Pt): void => {
    s.held = heldPosition(p, s.pointerType);
    s.samples.push({ ...s.held, t: performance.now() });
    if (s.samples.length > 12) s.samples.shift();
    placeGhost(s.held);
    const m = metrics();
    if (!m) return;
    const units = clientToUnits(m.rect, s.held);
    if (!reducedRef.current) ctl()?.gaze(gazeToward(units, geoRef.current.geo.eyeY));
    if (s.item === "star") return;
    const st = dragState(s.held, m.mouth, m.W, ITEM[s.item].target, insideBody(units, geoRef.current.kind));
    s.state = st;
    const open = st.phase !== "far";
    if (open !== mouthOpen.current) {
      mouthOpen.current = open;
      ctl()?.hold("mouth", open ? "o" : null);
      if (open) haptic(GESTURE.HAPTIC_MS, reducedRef.current);
    }
  };

  const endItem = (s: ItemSession, cancelled: boolean): void => {
    releaseFace();
    if (!s.started) return; // simple appui : le clic (souris, tactile, clavier) fait l'action
    if (s.item === "star") {
      const m = metrics();
      const v = releaseVelocity(s.samples);
      if (!cancelled && m && isFlick(v)) {
        throwStar(s.held, v, m);
      } else if (!cancelled && m && insideBody(clientToUnits(m.rect, s.held), geoRef.current.kind)) {
        setGhost(null);
        touchCreature();
      } else {
        returnGhost("star");
      }
      return;
    }
    const outcome = dropOutcome(s.state ?? { phase: "far", distance: Infinity }, cancelled);
    const def = ITEM[s.item];
    if (outcome === "give" && def.action) {
      setGhost(null);
      haptic(GESTURE.HAPTIC_DONE_MS, reducedRef.current);
      act(def.action);
    } else {
      returnGhost(s.item);
    }
  };

  // --- Corps : caresse, frottement, touche ---------------------------------------------------------

  const updateBody = (s: BodySession, p: Pt, timeStamp: number): void => {
    const m = metrics();
    if (!m) return;
    const units = clientToUnits(m.rect, p);
    const inside = insideBody(units, geoRef.current.kind);
    if (!s.moved && !isTap(s.start, p, 0)) s.moved = true;
    const norm = { x: p.x / m.W, y: p.y / m.W };
    if (modeRef.current === "wash") {
      placeGhost({ x: p.x + spongeOffset(s.pointerType).x, y: p.y + spongeOffset(s.pointerType).y });
      if (inside && !eyesShut.current) {
        eyesShut.current = true;
        ctl()?.hold("eye-left", "closed");
        ctl()?.hold("eye-right", "closed");
      }
      const r = scrub.current.add(norm, inside);
      ctl()?.stains(1 - 0.92 * r.progress);
      if (inside && r.path - lastBubble.current >= GESTURE.SCRUB_BUBBLE_EVERY) {
        lastBubble.current = r.path;
        burstChannel.emit({ preset: "wash", count: 3, emitDuration: 300 });
        haptic(GESTURE.HAPTIC_MS, reducedRef.current);
      }
      if (r.justReached) {
        s.moved = true;
        haptic(GESTURE.HAPTIC_DONE_MS, reducedRef.current);
        exitWash(true);
        act({ type: "clean" });
      }
      return;
    }
    if (!reducedRef.current && inside) {
      const k = clamp((units.x - 120) / 60, -1, 1);
      ctl()?.lean({ translate: [k * PET_LEAN_PX, 0], rotate: k * PET_LEAN_DEG });
      ctl()?.gaze(gazeToward(units, geoRef.current.geo.eyeY));
    }
    const r = s.pet.add(norm, timeStamp, inside);
    if (r.justReached && !s.petSent) {
      s.petSent = true;
      ctl()?.lean(null);
      haptic(GESTURE.HAPTIC_DONE_MS, reducedRef.current);
      act({ type: "pet" });
    }
  };

  const endBody = (s: BodySession, p: Pt, timeStamp: number, cancelled: boolean): void => {
    ctl()?.lean(null);
    if (modeRef.current === "wash") {
      scrub.current.lift();
      if (eyesShut.current) {
        eyesShut.current = false;
        ctl()?.hold("eye-left", null);
        ctl()?.hold("eye-right", null);
      }
      return;
    }
    ctl()?.gaze(null);
    if (!cancelled && !s.petSent && isTap(s.start, p, timeStamp - s.startT)) touchCreature();
  };

  // --- Événements ----------------------------------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (sess.current || flight.current || asleep) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = { x: e.clientX, y: e.clientY };
    const el = (e.target as Element).closest<HTMLElement>("[data-item]");
    const item = el?.dataset["item"] as ItemId | undefined;
    if (item && ITEM[item]) {
      sess.current = {
        kind: "item",
        item,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        start: p,
        started: false,
        held: p,
        samples: [{ ...p, t: performance.now() }],
        state: null,
      };
      return;
    }
    const m = metrics();
    if (!m || !insideBody(clientToUnits(m.rect, p), geoRef.current.kind)) return;
    sess.current = {
      kind: "body",
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      start: p,
      startT: e.timeStamp,
      moved: false,
      pet: new PetStroke(),
      petSent: false,
    };
    capture(e.currentTarget, e.pointerId);
    updateBody(sess.current, p, e.timeStamp);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = { x: e.clientX, y: e.clientY };
    const s = sess.current;
    if (!s) {
      // Souris sans bouton enfoncé : l'éponge suit le curseur.
      if (modeRef.current === "wash" && e.pointerType === "mouse") placeGhost({ x: p.x + SPONGE_OFFSET_MOUSE.x, y: p.y + SPONGE_OFFSET_MOUSE.y });
      return;
    }
    if (s.pointerId !== e.pointerId) return;
    if (s.kind === "body") {
      updateBody(s, p, e.timeStamp);
      return;
    }
    if (!s.started) {
      if (!isDragStart(s.start, p)) return;
      s.started = true;
      capture(e.currentTarget, e.pointerId);
      if (s.item === "sponge") {
        // Glisser l'éponge depuis le plateau : on entre dans le mode laver et on frotte dans la foulée.
        enterWash();
        const b: BodySession = {
          kind: "body",
          pointerId: s.pointerId,
          pointerType: s.pointerType,
          start: s.start,
          startT: e.timeStamp,
          moved: true,
          pet: new PetStroke(),
          petSent: false,
        };
        sess.current = b;
        updateBody(b, p, e.timeStamp);
        return;
      }
      exitWash();
      setGhost(s.item);
    }
    updateItem(s, p);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false): void => {
    const s = sess.current;
    if (!s || s.pointerId !== e.pointerId) return;
    sess.current = null;
    const p = { x: e.clientX, y: e.clientY };
    if (s.kind === "body") endBody(s, p, e.timeStamp, cancelled);
    else endItem(s, cancelled);
  };

  // Échap : annule l'objet tenu, sinon quitte le mode laver.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const s = sess.current;
      if (s && s.kind === "item" && s.started) {
        sess.current = null;
        endItem(s, true);
      } else if (modeRef.current === "wash") {
        sess.current = null;
        exitWash();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitWash]);

  // Démontage (Envol, sauvegarde réinitialisée) : on rend la créature à elle-même.
  useEffect(
    () => () => {
      flight.current = null;
      const c = getCreatureControl();
      c?.lean(null);
      c?.gaze(null);
      c?.hold("mouth", null);
      c?.stains(null);
    },
    [],
  );

  // --- Activation sans geste (clic, touche, Entrée) --------------------------------------------------

  const onTrayClick = (id: ItemId): void => {
    if (id === "sponge") {
      if (modeRef.current === "wash") exitWash();
      else enterWash();
      return;
    }
    exitWash();
    const def = ITEM[id];
    if (def.action) act(def.action);
  };

  const hint =
    mode === "wash"
      ? `Frotte ${name} doucement avec l'éponge, jusqu'à ce que tout brille.`
      : asleep
        ? `${name} dort. Laisse-lui un peu de calme.`
        : `Touche ${name} ou fais-lui une caresse. Tu peux aussi glisser un objet jusqu'à lui.`;

  return (
    <div
      className="playarea"
      ref={areaRef}
      data-mode={mode ?? "idle"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerUp(e)}
      onPointerCancel={(e) => onPointerUp(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <div className="playhint">
        <p className="hint" role="status" aria-live="polite">
          {hint}
        </p>
        {mode === "wash" && (
          <button type="button" className="mode-exit" onClick={() => exitWash()}>
            Terminer (Échap)
          </button>
        )}
      </div>
      {!asleep && (
        <div className="tray" role="group" aria-label="Objets pour s'occuper de la créature">
          {ITEMS.map((it) => (
            <button
              key={it.id}
              type="button"
              className="tray-item"
              data-item={it.id}
              aria-label={it.aria}
              aria-pressed={it.id === "sponge" ? mode === "wash" : undefined}
              onClick={() => onTrayClick(it.id)}
            >
              <span className="tray-disc">
                <PropIcon file={it.file} idp={`tray-${it.id}`} />
              </span>
              <span className="tray-label" aria-hidden="true">
                {it.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {ghost && (
        <div className="ghost" ref={ghostRef} data-item-ghost={ghost} aria-hidden="true">
          <PropIcon file={ITEM[ghost].file} idp={`ghost-${ghost}`} />
        </div>
      )}
    </div>
  );
}
