// Poignée de commande de la créature affichée, pour l'interface et les gestes (même principe que
// effects.ts : la créature s'inscrit, les autres modules l'appellent sans passer de props).
import type { Pt, StageRect } from "./geometry";
import type { Vec2 } from "./types";

export interface CreatureControl {
  /** Joue une réaction de reactions.json sur la couche du dessus ; la précédente s'arrête. */
  play(reactionId: string): void;
  /** Suit un geste : inclinaison et translation d'ensemble (null : relâché). */
  lean(v: { translate: Vec2; rotate: number } | null): void;
  /** Regard, en unités du repère (null : relâché). */
  gaze(v: Pt | null): void;
  /** Tient une variante d'une partie (bouche ouverte...), null pour la relâcher. */
  hold(part: string, variant: string | null): void;
  /** Opacité des taches (1 = visibles), null pour revenir à l'état. */
  stains(opacity: number | null): void;
  /** Cadre de la scène à l'écran, ou null. */
  rect(): StageRect | null;
}

let control: CreatureControl | null = null;

export function setCreatureControl(c: CreatureControl | null): void {
  control = c;
}

export function getCreatureControl(): CreatureControl | null {
  return control;
}

/**
 * Demande une réaction juste après la mise à jour de l'affichage : un changement d'état empile une
 * nouvelle couche, et la réaction doit se jouer sur elle, pas sur celle qui s'efface.
 */
export function requestReaction(id: string): void {
  setTimeout(() => control?.play(id), 0);
}
