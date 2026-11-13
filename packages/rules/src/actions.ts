// Actions du joueur (docs/equilibrage.md, section 3.5).
import { clamp } from "./advance";
import type { Balance } from "./balance";
import type { Action, GameEvent, Pet } from "./types";

type CooldownedKey = "feed.meal" | "feed.snack" | "heal" | "pet";

function onCooldown(p: Pet, key: CooldownedKey, now: number): boolean {
  return (p.cooldowns[key] ?? 0) > now;
}

function startCooldown(p: Pet, key: CooldownedKey, seconds: number, now: number): void {
  p.cooldowns[key] = now + seconds * 1000;
}

/**
 * Applique une action à un animal vivant (déjà rattrapé à `now`).
 * Renvoie la raison du refus, ou `null` si l'action est appliquée. Ne lève jamais.
 * Ne gère ni `tick` (rien à faire) ni `rebirth` (voir reduce).
 */
export function applyAction(p: Pet, action: Action, now: number, b: Balance, ev: GameEvent[]): string | null {
  const g = p.gauges;
  const st = p.status;
  if (st.asleep && action.type !== "wake" && action.type !== "tick") return "asleep";

  switch (action.type) {
    case "tick":
    case "rebirth":
      return null;
    case "feed": {
      const key = action.food === "meal" ? "feed.meal" : "feed.snack";
      const cfg = b.actions[key];
      if (g.satiety > cfg.refusedAboveSatiety) return "notHungry";
      if (onCooldown(p, key, now)) return "cooldown";
      g.satiety = clamp(g.satiety + cfg.satiety);
      g.happiness = clamp(g.happiness + cfg.happiness);
      startCooldown(p, key, cfg.cooldownSeconds, now);
      return null;
    }
    case "play": {
      const cfg = b.actions.play;
      if (g.energy <= cfg.requiresEnergyAbove) return "tooTired";
      g.happiness = clamp(g.happiness + cfg.happiness);
      g.energy = clamp(g.energy + cfg.energy);
      g.satiety = clamp(g.satiety + cfg.satiety);
      return null;
    }
    case "clean": {
      const cfg = b.actions.clean;
      if (g.hygiene >= 100 && st.messes === 0) return "alreadyClean";
      g.hygiene = clamp(cfg.hygiene);
      if (cfg.clearsMesses) st.messes = 0;
      return null;
    }
    case "heal": {
      const cfg = b.actions.heal;
      if (!st.sick && g.health >= 100) return "nothingToHeal";
      if (onCooldown(p, "heal", now)) return "cooldown";
      if (cfg.curesSickness && st.sick) {
        st.sick = false;
        st.sickSince = null;
        ev.push({ type: "recovered" });
      }
      g.health = clamp(g.health + cfg.health);
      startCooldown(p, "heal", cfg.cooldownSeconds, now);
      return null;
    }
    case "pet": {
      const cfg = b.actions.pet;
      if (onCooldown(p, "pet", now)) return "cooldown";
      g.happiness = clamp(g.happiness + cfg.happiness);
      startCooldown(p, "pet", cfg.cooldownSeconds, now);
      return null;
    }
    case "sleep": {
      if (g.energy > b.sleep.manualSleepMaxEnergy) return "notTired";
      st.asleep = true;
      st.asleepSince = now;
      ev.push({ type: "fellAsleep" });
      return null;
    }
    case "wake": {
      if (!st.asleep) return "notAsleep";
      if (g.energy <= b.sleep.autoSleepAtOrBelowEnergy) return "exhausted";
      st.asleep = false;
      st.asleepSince = null;
      ev.push({ type: "wokeUp" });
      return null;
    }
  }
}
