// Enregistrement du service worker (production seulement : en développement, Vite sert les modules à chaud)
// et mise à jour propre : la nouvelle version attend que le joueur la demande ; la sauvegarde est écrite
// avant le rechargement.
import { SW_FILE, publicUrl } from "./paths";

export interface UpdateHandle {
  /** Active la nouvelle version puis recharge la page. */
  apply(): void;
}

type Listener = (update: UpdateHandle | null) => void;
const listeners = new Set<Listener>();
let pending: UpdateHandle | null = null;

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
}

function announce(handle: UpdateHandle): void {
  pending = handle;
  listeners.forEach((l) => l(handle));
}

export function registerServiceWorker(beforeReload: () => Promise<void>): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  let reloading = false;

  const watch = (reg: ServiceWorkerRegistration): void => {
    const waiting = (): void => {
      const worker = reg.waiting;
      if (!worker || !navigator.serviceWorker.controller) return;
      announce({
        apply: () => {
          void beforeReload().finally(() => worker.postMessage({ type: "SKIP_WAITING" }));
        },
      });
    };
    waiting();
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") waiting();
      });
    });
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !pending) return; // première installation : rien à recharger
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(publicUrl(SW_FILE, base), { scope: publicUrl("", base) })
      .then(watch)
      .catch(() => {
        // Le jeu fonctionne sans service worker (pas de mode hors ligne).
      });
  });
}
