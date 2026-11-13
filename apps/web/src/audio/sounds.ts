// Partitions des sons : des données, pas du code. Chaque son est une courte suite de notes de carillon
// (cristal, boîte à musique), dans une gamme pentatonique de do : tout s'accorde, rien ne détonne.
// Durée totale (début + durée de la dernière note) : 1,2 s au plus. Volumes bas : l'ambiance reste douce.

export type SoundName =
  | "meal"
  | "snack"
  | "clean"
  | "heal"
  | "play"
  | "pet"
  | "sleep"
  | "wake"
  | "refuse"
  | "hatch"
  | "stage"
  | "need"
  | "weak"
  | "flight"
  | "rebirth"
  | "chime";

/** `chime` : cristal (partiels inharmoniques, très discrets) ; `soft` : presque un sinus pur, attaque lente. */
export type Timbre = "chime" | "soft";

export interface Note {
  /** Début, en secondes après le déclenchement. */
  t: number;
  /** Fréquence en Hz. */
  f: number;
  /** Durée (décroissance comprise), en secondes. */
  d: number;
  /** Volume de crête (0 à 1, avant le volume général). */
  v?: number;
  /** Glissando : rapport de la fréquence finale à la fréquence de départ. */
  glide?: number;
  timbre?: Timbre;
  /** Attaque, en secondes. */
  attack?: number;
}

export const MAX_SOUND_SECONDS = 1.2;

// Fréquences (Hz) de la gamme de do pentatonique.
const A3 = 220;
const E4 = 329.63;
const G4 = 392;
const A4 = 440;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.51;
const G6 = 1567.98;
const C7 = 2093;

export const SOUNDS: Record<SoundName, readonly Note[]> = {
  // Repas : trois notes qui montent, rondes et rassasiantes.
  meal: [
    { t: 0, f: C5, d: 0.5, v: 0.14 },
    { t: 0.12, f: E5, d: 0.5, v: 0.14 },
    { t: 0.24, f: G5, d: 0.55, v: 0.14 },
  ],
  // Goûter : deux petites notes claires, plus légères.
  snack: [
    { t: 0, f: G5, d: 0.35, v: 0.12 },
    { t: 0.1, f: C6, d: 0.4, v: 0.12 },
  ],
  // Bulles : de petits « plop » qui glissent vers l'aigu.
  clean: [
    { t: 0, f: 700, d: 0.14, v: 0.1, glide: 1.6, timbre: "soft" },
    { t: 0.09, f: 940, d: 0.14, v: 0.1, glide: 1.5, timbre: "soft" },
    { t: 0.17, f: 820, d: 0.14, v: 0.09, glide: 1.7, timbre: "soft" },
    { t: 0.27, f: 1180, d: 0.15, v: 0.09, glide: 1.4, timbre: "soft" },
    { t: 0.36, f: 1040, d: 0.2, v: 0.08, glide: 1.5, timbre: "soft" },
  ],
  // Soin : un accord chaud qui s'ouvre, puis une note de lumière.
  heal: [
    { t: 0, f: C5, d: 0.9, v: 0.11, timbre: "soft", attack: 0.04 },
    { t: 0.05, f: E5, d: 0.85, v: 0.1, timbre: "soft", attack: 0.04 },
    { t: 0.1, f: G5, d: 0.8, v: 0.1, timbre: "soft", attack: 0.04 },
    { t: 0.3, f: C6, d: 0.8, v: 0.1 },
  ],
  // Jeu : l'étoile rebondit, de plus en plus vite et de plus en plus haut.
  play: [
    { t: 0, f: G5, d: 0.25, v: 0.13, glide: 1.12 },
    { t: 0.17, f: C6, d: 0.25, v: 0.13, glide: 1.12 },
    { t: 0.3, f: E6, d: 0.3, v: 0.12, glide: 1.1 },
    { t: 0.4, f: G6, d: 0.4, v: 0.1 },
  ],
  // Caresse : un petit ronronnement lumineux (battements rapides et tendres) qui s'épanouit.
  pet: [
    { t: 0, f: A4, d: 0.12, v: 0.07, timbre: "soft" },
    { t: 0.08, f: A4, d: 0.12, v: 0.08, timbre: "soft" },
    { t: 0.16, f: A4, d: 0.12, v: 0.08, timbre: "soft" },
    { t: 0.24, f: A4, d: 0.12, v: 0.07, timbre: "soft" },
    { t: 0.32, f: A4, d: 0.12, v: 0.06, timbre: "soft" },
    { t: 0.2, f: E5, d: 0.7, v: 0.1, attack: 0.05 },
  ],
  // Coucher : berceuse de trois notes qui descendent doucement.
  sleep: [
    { t: 0, f: E5, d: 0.55, v: 0.12, timbre: "soft", attack: 0.03 },
    { t: 0.3, f: C5, d: 0.55, v: 0.11, timbre: "soft", attack: 0.03 },
    { t: 0.6, f: G4, d: 0.6, v: 0.1, timbre: "soft", attack: 0.03 },
  ],
  // Réveil : quatre notes qui montent comme le jour.
  wake: [
    { t: 0, f: G4, d: 0.4, v: 0.12 },
    { t: 0.1, f: C5, d: 0.4, v: 0.12 },
    { t: 0.2, f: E5, d: 0.4, v: 0.12 },
    { t: 0.3, f: G5, d: 0.45, v: 0.12 },
  ],
  // Refus : un « hmm » presque murmuré, deux notes proches qui retombent. Jamais sec, jamais un buzz.
  refuse: [
    { t: 0, f: A4, d: 0.3, v: 0.07, timbre: "soft", attack: 0.03 },
    { t: 0.14, f: G4, d: 0.35, v: 0.06, timbre: "soft", attack: 0.03 },
  ],
  // Éclosion : un arpège d'étincelles et, dessous, une grande cloche claire.
  hatch: [
    { t: 0, f: C5, d: 1, v: 0.1, attack: 0.02 },
    { t: 0.05, f: C6, d: 0.45, v: 0.11 },
    { t: 0.12, f: E6, d: 0.45, v: 0.1 },
    { t: 0.19, f: G6, d: 0.45, v: 0.09 },
    { t: 0.26, f: C7, d: 0.55, v: 0.07 },
  ],
  // Passage de stade : une petite fanfare de cristal, qui monte.
  stage: [
    { t: 0, f: G5, d: 0.45, v: 0.12 },
    { t: 0.12, f: A5, d: 0.45, v: 0.12 },
    { t: 0.24, f: C6, d: 0.45, v: 0.12 },
    { t: 0.36, f: E6, d: 0.6, v: 0.11 },
  ],
  // Besoin : une seule note, discrète, qui dit « je suis là ».
  need: [{ t: 0, f: D6, d: 0.45, v: 0.06 }],
  // Affaiblie : grave et tendre, comme une main posée sur l'épaule. Rien d'alarmant.
  weak: [
    { t: 0, f: A3, d: 0.7, v: 0.12, timbre: "soft", attack: 0.08 },
    { t: 0.25, f: E4, d: 0.7, v: 0.1, timbre: "soft", attack: 0.08 },
  ],
  // Envol : une montée lumineuse, de plus en plus aérienne.
  flight: [
    { t: 0, f: C5, d: 0.5, v: 0.1 },
    { t: 0.12, f: E5, d: 0.5, v: 0.1 },
    { t: 0.24, f: G5, d: 0.5, v: 0.1 },
    { t: 0.36, f: C6, d: 0.5, v: 0.09 },
    { t: 0.48, f: E6, d: 0.5, v: 0.08 },
    { t: 0.6, f: G6, d: 0.5, v: 0.07 },
  ],
  // Renaissance : une lueur qui s'allume (accord tenu) puis trois notes qui s'éveillent.
  rebirth: [
    { t: 0, f: C5, d: 1.05, v: 0.09, timbre: "soft", attack: 0.06 },
    { t: 0.15, f: G5, d: 0.6, v: 0.11 },
    { t: 0.3, f: C6, d: 0.6, v: 0.11 },
    { t: 0.45, f: E6, d: 0.6, v: 0.1 },
  ],
  // Petite note de confirmation (activation du son).
  chime: [
    { t: 0, f: C6, d: 0.5, v: 0.1 },
    { t: 0.14, f: G6, d: 0.5, v: 0.08 },
  ],
};

/** Durée totale d'un son, en secondes. */
export function soundLength(name: SoundName): number {
  return Math.max(...SOUNDS[name].map((n) => n.t + n.d));
}
