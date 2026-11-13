// Petit bus entre l'interface, la créature et la couche de particules (un seul canvas en surimpression).
// Les écrans n'ont pas à se passer de props : « une action a réussi », « voici où est la créature ».
import type { Action } from "@tamagoshi/rules";

/** Position de la créature à l'écran : origine (pixels) du repère 240 de ses parties, et pixels par unité. */
export interface Anchor {
  x: number;
  y: number;
  scale: number;
}

export interface BurstRequest {
  preset: string;
  /** Remplace `count` du préréglage (ex. quelques petites lunes pour coucher). */
  count?: number;
  emitDuration?: number;
}

type Listener<T> = (value: T) => void;

class Channel<T> {
  private listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    this.listeners.forEach((l) => l(value));
  }
}

/** Action réussie (nourrir, laver, soigner, jouer, caresser, coucher) : retour lumineux sur le halo. */
export const careChannel = new Channel<Action["type"]>();
/** Bouffée de particules demandée. */
export const burstChannel = new Channel<BurstRequest>();
/** Préréglages continus actifs (lucioles, petites lunes). */
export const continuousChannel = new Channel<readonly string[]>();

let anchorGetter: (() => Anchor | null) | null = null;
export function setAnchorGetter(fn: (() => Anchor | null) | null): void {
  anchorGetter = fn;
}
export function getAnchor(): Anchor | null {
  return anchorGetter ? anchorGetter() : null;
}

/** Actions qui ravivent le halo (les particules viennent des réactions : spec/motion/reactions.json). */
const GLOWING: readonly Action["type"][] = ["feed", "clean", "heal", "play", "sleep", "pet"];

/** À appeler quand une action a été acceptée par les règles : le halo s'intensifie. */
export function celebrate(action: Action["type"]): void {
  if (GLOWING.includes(action)) careChannel.emit(action);
}
