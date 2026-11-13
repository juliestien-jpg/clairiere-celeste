// Boutons d'action en « pierres de lune » : icône + libellé texte, cibles d'au moins 48 px.
import type { Action } from "@tamagoshi/rules";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface Def {
  key: string;
  label: string;
  icon: IconName;
  action: Action;
}

const DEFS: Def[] = [
  { key: "meal", label: "Repas", icon: "bowl", action: { type: "feed", food: "meal" } },
  { key: "snack", label: "Goûter", icon: "fruit", action: { type: "feed", food: "snack" } },
  { key: "play", label: "Jouer", icon: "sparkle", action: { type: "play" } },
  { key: "clean", label: "Laver", icon: "drop", action: { type: "clean" } },
  { key: "heal", label: "Soigner", icon: "leaf", action: { type: "heal" } },
  { key: "pet", label: "Caresser", icon: "heart", action: { type: "pet" } },
  { key: "sleep", label: "Coucher", icon: "moon", action: { type: "sleep" } },
  { key: "wake", label: "Réveiller", icon: "sun", action: { type: "wake" } },
];

/** Endormi : seul « Réveiller » reste pertinent (D4 : les boutons non pertinents s'effacent). */
export function ActionBar({ asleep, onAction }: { asleep: boolean; onAction: (a: Action) => void }) {
  const shown = DEFS.filter((d) => (asleep ? d.key === "wake" : d.key !== "wake"));
  return (
    <div className="actions" role="group" aria-label="Prendre soin">
      {shown.map((d) => (
        <button key={d.key} type="button" className="stone" onClick={() => onAction(d.action)}>
          <span className="stone-disc">
            <Icon name={d.icon} />
          </span>
          <span className="stone-label">{d.label}</span>
        </button>
      ))}
    </div>
  );
}
