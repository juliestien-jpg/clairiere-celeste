// Correspondance action / événement des règles -> son. Fonction pure : testable sans audio.
// Règles : jamais de son en boucle ni pour chaque tick ; au plus un son « résumé » quand le temps a été
// rattrapé (retour après une absence) ; un refus est un murmure, sauf pour la caresse (toujours tendre).
import type { Action, GameEvent } from "@tamagoshi/rules";
import type { SoundName } from "./sounds";

export interface SoundCue {
  name: SoundName;
  /** Retard par rapport au déclenchement, en secondes. */
  delay: number;
}

export interface CueOptions {
  /** Le tick vient de rattraper un long laps de temps (réouverture, saut d'horloge). */
  catchUp: boolean;
  /** Un refus n'est pas annoncé (caresse). */
  silentRefusal?: boolean;
}

const ACTION_SOUND: Partial<Record<Action["type"], SoundName>> = {
  play: "play",
  clean: "clean",
  heal: "heal",
  sleep: "sleep",
  wake: "wake",
  pet: "pet",
};

/** Délai du son d'événement marquant (stade, Envol…) derrière celui de l'action, pour ne pas les superposer. */
const FOLLOW_UP_DELAY = 0.8;

function milestone(events: readonly GameEvent[]): SoundName | null {
  if (events.some((e) => e.type === "flewAway")) return "flight";
  if (events.some((e) => e.type === "reborn")) return "rebirth";
  const stage = events.find((e) => e.type === "stageChanged");
  if (stage && stage.type === "stageChanged") return stage.from === "egg" ? "hatch" : "stage";
  if (events.some((e) => e.type === "weakened")) return "weak";
  return null;
}

/** Un seul son pour un tick : le plus important de ce qui s'est passé. */
function tickSummary(events: readonly GameEvent[], catchUp: boolean): SoundName | null {
  const big = milestone(events);
  if (big) return big;
  if (events.some((e) => e.type === "becameSick" || e.type === "needAppeared")) return "need";
  if (catchUp) return null; // Au retour d'une absence : pas de coucher ni de réveil rejoués.
  if (events.some((e) => e.type === "wokeUp")) return "wake";
  if (events.some((e) => e.type === "fellAsleep")) return "sleep";
  return null;
}

export function cuesFor(action: Action, events: readonly GameEvent[], opts: CueOptions): SoundCue[] {
  if (action.type === "tick") {
    const name = tickSummary(events, opts.catchUp);
    return name ? [{ name, delay: 0 }] : [];
  }
  if (events.some((e) => e.type === "actionRefused")) {
    return opts.silentRefusal ? [] : [{ name: "refuse", delay: 0 }];
  }
  const base: SoundName | undefined = action.type === "feed" ? (action.food === "meal" ? "meal" : "snack") : ACTION_SOUND[action.type];
  const cues: SoundCue[] = base ? [{ name: base, delay: 0 }] : [];
  const extra = milestone(events);
  if (extra) cues.push({ name: extra, delay: base ? FOLLOW_UP_DELAY : 0 });
  return cues;
}
