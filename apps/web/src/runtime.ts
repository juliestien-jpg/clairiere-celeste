// Assemblage de l'application : horloge, sauvegarde, boucle. Une seule instance par onglet.
import { defaultBalance } from "@tamagoshi/rules";
import { VirtualClock } from "./loop/clock";
import { GameLoop } from "./loop/gameLoop";
import { createDefaultStore } from "./storage/indexedDbStore";

const { store, persistent } = createDefaultStore();

// En débogage, le décalage de l'heure virtuelle (sauts, accélération) survit au rechargement.
// Sans cela, une sauvegarde créée à une heure virtuelle avancée paraît « dans le futur » après
// rechargement, et les règles (qui ne font jamais reculer le temps) figent l'animal.
const DEBUG_CLOCK_KEY = "tamagoshi.debugClockOffsetMs";
const debugClock = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");

function readSavedOffset(): number {
  if (!debugClock) return 0;
  try {
    const value = Number(localStorage.getItem(DEBUG_CLOCK_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export const clock = new VirtualClock(undefined, readSavedOffset());
export const game = new GameLoop({ clock, balance: defaultBalance, store });
export const storagePersistent = persistent;

if (debugClock) {
  const persistOffset = (): void => {
    try {
      localStorage.setItem(DEBUG_CLOCK_KEY, String(clock.offsetMs));
    } catch {
      // Stockage indisponible : le décalage sera simplement perdu au rechargement.
    }
  };
  setInterval(persistOffset, 2000);
  addEventListener("pagehide", persistOffset);

  // Filet de sécurité : si la sauvegarde est malgré tout plus récente que l'heure virtuelle,
  // on avance l'horloge jusqu'à elle plutôt que de laisser l'animal figé.
  void game.init().then(() => {
    const last = game.getSnapshot().state?.pet.lastUpdatedAt;
    const now = clock.now();
    if (last !== undefined && last > now) game.jump(last - now);
  });
}
