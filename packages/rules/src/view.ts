// Vue dérivée pour l'affichage (docs/equilibrage.md, section 3.8).
import { catchUp } from "./advance";
import { assertBalance } from "./balance";
import type { Balance } from "./balance";
import { cloneSave } from "./state";
import type { Gauge, GaugeLevel, Need, PrimaryState, SaveState, Time, View } from "./types";

export function levelOf(v: number, g: { low: number; critical: number }): GaugeLevel {
  if (v <= g.critical) return "critical";
  if (v <= g.low) return "low";
  return "ok";
}

/**
 * État à afficher à l'instant `time` : l'état est projeté jusqu'au dernier point de grille <= `time` (copie, sans effet
 * sur `state`), puis dérivé. Priorité de D4 : weak > sick > asleep > hungry > dirty > tired > happy.
 * `secondary` : au plus 2 autres besoins actifs, dans l'ordre sick, satiety, hygiene, energy,
 * happiness (l'énergie est omise quand l'animal dort : le sommeil est justement sa réponse).
 */
export function deriveView(state: SaveState, time: Time, balance: Balance): View {
  assertBalance(balance);
  const s = cloneSave(state);
  const p = s.pet;
  if (p.life === "alive") catchUp(p, time.nowMs, balance, null); // même grille fixe que `reduce`
  const g = p.gauges;
  const c = balance.gauges;

  const gaugeLevels: Record<Gauge, GaugeLevel> = {
    satiety: levelOf(g.satiety, c.satiety),
    happiness: levelOf(g.happiness, c.happiness),
    energy: levelOf(g.energy, c.energy),
    hygiene: levelOf(g.hygiene, c.hygiene),
    health: levelOf(g.health, c.health),
  };
  if (p.life === "flown") return { kind: p.kind, primary: "flown", secondary: [], gaugeLevels };

  const hungry = g.satiety <= c.satiety.low;
  const dirty = g.hygiene <= c.hygiene.low;
  const tired = g.energy <= c.energy.low;
  const unhappy = g.happiness <= c.happiness.low;
  const weak = p.status.weakSince !== null;
  const sick = p.status.sick;
  const asleep = p.status.asleep;

  let primary: PrimaryState = "happy";
  if (weak) primary = "weak";
  else if (sick) primary = "sick";
  else if (asleep) primary = "asleep";
  else if (hungry) primary = "hungry";
  else if (dirty) primary = "dirty";
  else if (tired) primary = "tired";

  const candidates: { need: Need; active: boolean }[] = [
    { need: "sick", active: sick && primary !== "sick" },
    { need: "satiety", active: hungry && primary !== "hungry" },
    { need: "hygiene", active: dirty && primary !== "dirty" },
    { need: "energy", active: tired && primary !== "tired" && !asleep },
    { need: "happiness", active: unhappy },
  ];
  const secondary = candidates.filter((x) => x.active).map((x) => x.need).slice(0, 2);
  return { kind: p.kind, primary, secondary, gaugeLevels };
}
