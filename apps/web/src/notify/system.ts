// Accès à l'API de notifications du navigateur : permission (demandée seulement par le joueur) et affichage.
import { publicUrl } from "../pwa/paths";
import type { PermissionState, ShownNotification } from "./notifier";

export function permissionState(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** À appeler uniquement quand le joueur active l'option : jamais au chargement. */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Notification système : via le service worker s'il est actif (le toucher ramène au jeu), sinon `Notification`. */
export async function showSystemNotification(n: ShownNotification): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: n.body,
    tag: n.tag,
    lang: "fr",
    icon: publicUrl("icons/icon-192.png"),
    badge: publicUrl("icons/icon-192.png"),
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration(publicUrl(""));
    if (reg?.active) {
      await reg.showNotification(n.title, options);
      return;
    }
  } catch {
    // Pas de service worker utilisable : repli ci-dessous.
  }
  try {
    const note = new Notification(n.title, options);
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {
    // Certains navigateurs mobiles n'autorisent que le service worker : le titre de l'onglet signale le besoin.
  }
}
