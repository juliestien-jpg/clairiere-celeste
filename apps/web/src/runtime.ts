// Assemblage de l'application : horloge, sauvegarde, boucle. Une seule instance par onglet.
import { defaultBalance } from "@tamagoshi/rules";
import { play } from "./audio";
import { cuesFor } from "./audio/events";
import { VirtualClock } from "./loop/clock";
import { GameLoop } from "./loop/gameLoop";
import { createLocalHistoryStore } from "./notify/history";
import { Notifier } from "./notify/notifier";
import { permissionState, showSystemNotification } from "./notify/system";
import { createDefaultStore } from "./storage/indexedDbStore";

const { store, persistent } = createDefaultStore();

// Débogage (développement uniquement, jamais en production) : le décalage de l'heure virtuelle (sauts, accélération) survit au rechargement.
// Sans cela, une sauvegarde créée à une heure virtuelle avancée paraît « dans le futur » après
// rechargement, et les règles (qui ne font jamais reculer le temps) figent l'animal.
const DEBUG_CLOCK_KEY = "tamagoshi.debugClockOffsetMs";
const debugClock = import.meta.env.DEV;

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
export const game = new GameLoop({
  clock,
  balance: defaultBalance,
  store,
  // Sons : une action ou un événement des règles -> au plus un ou deux sons (jamais une cascade au rattrapage).
  onDispatch: ({ action, events, catchUp, silentRefusal }) => {
    for (const cue of cuesFor(action, events, { catchUp, silentRefusal })) play(cue.name, cue.delay);
  },
});
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

// Notifications « page ouverte » (D5) : démarrées par l'application, après le chargement de la sauvegarde.
export const notifier = new Notifier({
  game,
  store: createLocalHistoryStore(),
  permission: permissionState,
  isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  show: (n) => void showSystemNotification(n),
});
