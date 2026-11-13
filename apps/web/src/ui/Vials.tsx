// Jauges en fioles : icône, libellé, valeur chiffrée et niveau écrit (jamais la couleur seule).
import type { Gauge, GaugeLevel, SaveState } from "@tamagoshi/rules";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { GAUGE_LABEL, GAUGE_ORDER, LEVEL_LABEL } from "./labels";

const GAUGE_ICON: Record<Gauge, IconName> = {
  satiety: "fruit",
  happiness: "sparkle",
  energy: "moon",
  hygiene: "drop",
  health: "leaf",
};

export function Vials({ state, levels }: { state: SaveState; levels: Record<Gauge, GaugeLevel> }) {
  return (
    <ul className="vials" aria-label="Jauges">
      {GAUGE_ORDER.map((g) => {
        const value = Math.round(state.pet.gauges[g]);
        const level = levels[g];
        return (
          <li key={g} className="vial" data-level={level}>
            <span className="vial-icon">
              <Icon name={GAUGE_ICON[g]} />
            </span>
            <div
              className="vial-glass"
              role="meter"
              aria-label={GAUGE_LABEL[g]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={`${value} sur 100, ${LEVEL_LABEL[level]}`}
            >
              <div className="vial-liquid" style={{ height: `${value}%` }} />
            </div>
            <span className="vial-label">{GAUGE_LABEL[g]}</span>
            <span className="vial-value" aria-hidden="true">
              {value}
              <span className="vial-level">{level === "ok" ? "" : ` · ${LEVEL_LABEL[level]}`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
