// Sons de la Clairière céleste : synthétisés avec la Web Audio API, aucun fichier audio.
// - Silence total tant que `settings.sound` est désactivé (réglage lu par l'application via `setSoundEnabled`).
// - Aucun `AudioContext` n'est créé avant le premier son réellement joué, lui-même précédé d'un geste du joueur
//   (politique d'autoplay, iOS compris) ; un son demandé avant tout geste est simplement abandonné.
// - Contexte suspendu quand la page est cachée ; aucun son non plus pendant qu'elle l'est.
import { MAX_SOUND_SECONDS, SOUNDS } from "./sounds";
import type { Note, SoundName, Timbre } from "./sounds";

export type { SoundName } from "./sounds";
export { MAX_SOUND_SECONDS };

// Sous-ensemble de l'API Web Audio utilisé ici (permet un faux contexte dans les tests).
export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface NodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface OscillatorLike extends NodeLike {
  type: string;
  frequency: ParamLike;
  onended: (() => void) | null;
  start(time: number): void;
  stop(time: number): void;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export interface AudioEngineDeps {
  createContext: () => AudioContextLike | null;
  isHidden?: () => boolean;
}

const MASTER_LEVEL = 0.6;
const FLOOR = 0.0001;
/** Un même son ne se rejoue pas avant ce délai (secondes) : pas de rafale. */
const MIN_REPEAT_S = 0.12;

/** Partiels (rapport de fréquence, part du volume, part de la durée) de chaque timbre. */
const PARTIALS: Record<Timbre, readonly (readonly [number, number, number])[]> = {
  chime: [
    [1, 1, 1],
    [2.76, 0.1, 0.45],
    [5.4, 0.04, 0.25],
  ],
  soft: [
    [1, 1, 1],
    [2, 0.08, 0.6],
  ],
};

export interface AudioEngine {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** À appeler à chaque geste du joueur : autorise le son et réveille un contexte endormi. */
  noteGesture(): void;
  /** Joue un son nommé, après `delay` secondes. Sans effet si le son est coupé ou sans geste préalable. */
  play(name: SoundName, delay?: number): void;
  /** La page est cachée (true) ou de nouveau visible (false). */
  setHidden(hidden: boolean): void;
  /** Le contexte n'existe qu'après un premier son joué. */
  hasContext(): boolean;
}

export function createAudioEngine(deps: AudioEngineDeps): AudioEngine {
  let enabled = false; // Silence tant que les réglages ne sont pas connus.
  let gestured = false;
  let ctx: AudioContextLike | null = null;
  let master: GainLike | null = null;
  const active = new Set<OscillatorLike>();
  const lastStart = new Map<SoundName, number>();
  const isHidden = deps.isHidden ?? (() => false);

  function ensureContext(): AudioContextLike | null {
    if (ctx) return ctx;
    try {
      ctx = deps.createContext();
      if (!ctx) return null;
      master = ctx.createGain();
      master.gain.value = MASTER_LEVEL;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function resume(): Promise<void> {
    if (!ctx || ctx.state === "running") return Promise.resolve();
    return ctx.resume().catch(() => undefined);
  }

  function voice(c: AudioContextLike, out: GainLike, note: Note, at: number): void {
    const timbre = note.timbre ?? "chime";
    const peak = note.v ?? 0.1;
    const attack = note.attack ?? 0.012;
    const start = at + note.t;
    for (const [ratio, share, span] of PARTIALS[timbre]) {
      const dur = Math.max(0.06, note.d * span);
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.f * ratio, start);
      if (note.glide) osc.frequency.exponentialRampToValueAtTime(note.f * ratio * note.glide, start + Math.min(note.d, 0.14));
      env.gain.setValueAtTime(FLOOR, start);
      env.gain.linearRampToValueAtTime(peak * share, start + Math.min(attack, dur / 2));
      env.gain.exponentialRampToValueAtTime(FLOOR, start + dur);
      osc.connect(env);
      env.connect(out);
      active.add(osc);
      osc.onended = () => {
        active.delete(osc);
        osc.disconnect();
        env.disconnect();
      };
      osc.start(start);
      osc.stop(start + dur + 0.05);
    }
  }

  function schedule(name: SoundName, delay: number): void {
    const c = ctx;
    if (!c || !master || !enabled || isHidden()) return;
    const at = c.currentTime + 0.03 + delay;
    for (const note of SOUNDS[name]) voice(c, master, note, at);
  }

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) {
        // Silence total, tout de suite : on coupe aussi ce qui sonne encore.
        for (const osc of [...active]) {
          try {
            osc.stop(0);
          } catch {
            // Déjà arrêté.
          }
        }
        active.clear();
      }
    },
    isEnabled: () => enabled,
    noteGesture() {
      gestured = true;
      // Réveille un contexte déjà créé (suspendu, ou « interrompu » sur iOS) ; n'en crée jamais.
      if (enabled && ctx && !isHidden()) void resume();
    },
    play(name, delay = 0) {
      if (!enabled || !gestured || isHidden()) return;
      const now = ctx?.currentTime ?? 0;
      const last = lastStart.get(name);
      if (last !== undefined && ctx && now - last < MIN_REPEAT_S) return;
      const c = ensureContext();
      if (!c) return;
      lastStart.set(name, c.currentTime);
      if (c.state === "running") {
        schedule(name, delay);
      } else {
        // Contexte encore endormi : on ne programme le son que s'il s'est réveillé (sinon il sonnerait trop tard).
        void resume().then(() => {
          if (c.state === "running") schedule(name, delay);
        });
      }
    },
    setHidden(hidden) {
      if (!ctx) return;
      if (hidden) void ctx.suspend().catch(() => undefined);
      else if (enabled && gestured) void resume();
    },
    hasContext: () => ctx !== null,
  };
}

// --- Instance de l'application ----------------------------------------------------------------

interface WindowWithWebkit {
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
}

function createBrowserContext(): AudioContextLike | null {
  const w = globalThis as unknown as WindowWithWebkit;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const engine = createAudioEngine({
  createContext: createBrowserContext,
  isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
});

export function setSoundEnabled(on: boolean): void {
  engine.setEnabled(on);
}

export function isSoundEnabled(): boolean {
  return engine.isEnabled();
}

export function play(name: SoundName, delay = 0): void {
  engine.play(name, delay);
}

/** Branche le déblocage au premier geste et la suspension quand la page est cachée. Renvoie la fonction de nettoyage. */
export function installAudioLifecycle(doc: Document = document): () => void {
  const onGesture = (): void => engine.noteGesture();
  const onVisibility = (): void => engine.setHidden(doc.visibilityState === "hidden");
  const gestures = ["pointerdown", "touchend", "keydown", "click"] as const;
  for (const g of gestures) doc.addEventListener(g, onGesture, { capture: true, passive: true });
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    for (const g of gestures) doc.removeEventListener(g, onGesture, { capture: true });
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
