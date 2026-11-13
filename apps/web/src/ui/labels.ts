// Textes de l'interface (français, ton doux et jamais culpabilisant, CLAUDE.md). Tournures neutres pour le genre
// de la créature : pas de « il », « fatigué », « devenu »… quand une autre formulation existe.
import type { Gauge, GameEvent, GaugeLevel, Kind, Need, PrimaryState, View } from "@tamagoshi/rules";

export const GAUGE_LABEL: Record<Gauge, string> = {
  satiety: "Satiété",
  happiness: "Joie",
  energy: "Énergie",
  hygiene: "Propreté",
  health: "Santé",
};

export const GAUGE_ORDER: readonly Gauge[] = ["satiety", "happiness", "energy", "hygiene", "health"];

/** Texte du niveau : l'information ne repose jamais sur la couleur seule. */
export const LEVEL_LABEL: Record<GaugeLevel, string> = {
  ok: "bien",
  low: "bas",
  critical: "très bas",
};

export function primaryLabel(primary: PrimaryState, name: string): string {
  switch (primary) {
    case "happy":
      return `${name} se sent bien`;
    case "hungry":
      return `${name} a faim`;
    case "tired":
      return `${name} a sommeil`;
    case "sick":
      return `${name} ne se sent pas très bien`;
    case "asleep":
      return `${name} dort paisiblement`;
    case "dirty":
      return `${name} aimerait une toilette`;
    case "weak":
      return `${name} a besoin de soins`;
    case "flown":
      return `${name} rejoint les étoiles`;
  }
}

const NEED_LABEL: Record<Need, string> = {
  satiety: "a un petit creux",
  hygiene: "aimerait une toilette",
  happiness: "aimerait jouer",
  energy: "a besoin de repos",
  sick: "ne se sent pas très bien",
  weak: "a besoin de soins",
};

export function needLabel(need: Need): string {
  return NEED_LABEL[need];
}

export function secondaryLabel(view: View, name: string): string | null {
  if (view.secondary.length === 0) return null;
  return `Aussi : ${name} ${view.secondary.map(needLabel).join(", ")}`;
}

/** Titre de l'onglet (D5, phase « page ouverte ») : signale le besoin dès qu'il apparaît. */
export function pageTitle(name: string | null, view: View | null): string {
  if (!name || !view) return "Clairière céleste";
  if (view.primary === "happy" || view.primary === "asleep") return `${name} · Clairière céleste`;
  return `● ${primaryLabel(view.primary, name)} · Clairière céleste`;
}

export function refusalText(reason: string, name: string): string {
  switch (reason) {
    case "asleep":
      return `${name} dort paisiblement. Le bouton Réveiller est là quand tu voudras.`;
    case "notHungry":
      return `${name} n'a pas faim pour l'instant.`;
    case "cooldown":
      return `Pas tout de suite : ${name} a besoin d'un petit moment.`;
    case "tooTired":
      return `${name} a besoin de repos avant de jouer. Un peu de calme lui fera du bien.`;
    case "alreadyClean":
      return `${name} est déjà tout propre.`;
    case "nothingToHeal":
      return `${name} se porte à merveille.`;
    case "notTired":
      return `${name} n'a pas sommeil pour l'instant.`;
    case "notAsleep":
      return `${name} a déjà les yeux ouverts.`;
    case "exhausted":
      return `${name} a encore besoin de dormir.`;
    case "invalidIdentity":
      return "Choisis un nom pour le nouvel œuf.";
    case "flownDuringCatchUp":
      return `${name} vient de rejoindre les étoiles. Une étoile veille sur la clairière.`;
    case "unknownAction":
    case "invalidAction":
      return "Je n'ai pas compris ce geste. Essaie encore ?";
    case "flown":
    case "notFlown":
      return "Rien à faire pour le moment.";
    default:
      return "Cette action n'est pas possible maintenant.";
  }
}

/** Nom de l'espèce, en toutes lettres (album, éclosion) : l'espèce n'est jamais portée par la forme ou la couleur seule. */
export const KIND_LABEL: Record<Kind, string> = {
  kawaii: "kawaii",
  feerique: "féérique",
};

/** Ce que le joueur découvre à l'éclosion. */
const HATCH_TEXT: Record<Kind, string> = {
  kawaii: "tout rond et tout doux",
  feerique: "un petit esprit de lumière",
};

/** Phrase pour un événement, ou `null` s'il ne mérite pas d'être annoncé. `kind` : espèce de l'animal. */
export function describeEvent(e: GameEvent, name: string, kind?: Kind): { text: string; refused: boolean } | null {
  switch (e.type) {
    case "actionRefused":
      return { text: refusalText(e.reason, name), refused: true };
    case "stageChanged":
      return {
        text:
          e.to === "baby"
            ? kind
              ? `L'œuf s'est ouvert : ${name} est là, ${HATCH_TEXT[kind]} !`
              : `L'œuf s'est ouvert : ${name} est là !`
            : `${name} a grandi.`,
        refused: false,
      };
    case "becameSick":
      return { text: `${name} ne se sent pas très bien. Un soin lui ferait du bien.`, refused: false };
    case "recovered":
      return { text: `${name} va mieux.`, refused: false };
    case "fellAsleep":
      return { text: `${name} s'endort doucement.`, refused: false };
    case "wokeUp":
      return { text: `${name} ouvre les yeux.`, refused: false };
    case "weakened":
      return { text: `${name} a besoin de soins pour retrouver sa lumière.`, refused: false };
    case "recoveredStrength":
      return { text: `${name} reprend des forces.`, refused: false };
    case "flewAway":
      return { text: `${name} rejoint les étoiles et veille sur la clairière.`, refused: false };
    case "reborn":
      return { text: "Une nouvelle lueur a pris la forme d'un œuf.", refused: false };
    case "clockAdjusted":
      return { text: "L'horloge de l'appareil a changé : la clairière s'est remise à l'heure.", refused: false };
    case "needAppeared":
    case "needResolved":
      return null;
  }
}

export function describeJournalEvent(e: GameEvent): string {
  switch (e.type) {
    case "stageChanged":
      return `stageChanged ${e.from} → ${e.to}`;
    case "needAppeared":
    case "needResolved":
      return `${e.type} (${e.need})`;
    case "actionRefused":
      return `actionRefused ${e.action} : ${e.reason}`;
    default:
      return e.type;
  }
}

/** Texte d'une notification système (D5) : doux, sans reproche, toujours issu d'un besoin réel. */
export function notificationContent(need: Need, name: string): { title: string; body: string } {
  const body: Record<Need, string> = {
    satiety: `${name} a un petit creux. Un repas lui ferait plaisir.`,
    hygiene: `${name} aimerait une petite toilette.`,
    happiness: `${name} aimerait jouer un peu avec toi.`,
    energy: `${name} a besoin de repos.`,
    sick: `${name} ne se sent pas très bien. Un soin lui ferait du bien.`,
    weak: `${name} a besoin de soins. Une petite visite lui ferait du bien.`,
  };
  return { title: "Clairière céleste", body: body[need] };
}
