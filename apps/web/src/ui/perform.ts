// Une action du joueur, qu'elle vienne d'un bouton ou d'un geste : les règles décident, puis la créature
// réagit (spec/motion/reactions.json) et le halo s'intensifie. Un seul chemin, donc la même réaction
// quelle que soit la façon de faire (critère 2.5.7 : le bouton et le geste font la même chose).
import type { Action } from "@tamagoshi/rules";
import { requestReaction } from "../creature/control";
import { celebrate } from "../creature/effects";
import { reactionForOutcome } from "../creature/reactions";
import { game } from "../runtime";

export interface PerformOptions {
  /** Réaction à jouer à la place de celle de l'action si elle est acceptée (ex. « catch »). */
  reaction?: string;
}

export type ActionHandler = (action: Action, options?: PerformOptions) => void;

export const perform: ActionHandler = (action, options = {}) => {
  // La caresse n'est jamais annoncée comme refusée : la créature répond avec tendresse dans tous les cas.
  const events = game.dispatch(action, { silentRefusal: action.type === "pet" });
  const refused = events.some((e) => e.type === "actionRefused");
  if (!refused) celebrate(action.type);
  const id = !refused && options.reaction ? options.reaction : reactionForOutcome(action, events);
  if (id) requestReaction(id);
};
