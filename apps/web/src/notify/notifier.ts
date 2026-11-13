// Notifications « page ouverte » (D5) : quand le besoin prédit par les règles (`nextAttentionAt`) apparaît,
// et seulement si le réglage est actif, la permission accordée et la page cachée (on ne dérange pas un
// joueur qui regarde déjà son animal), une notification système est affichée. Aucun rappel à heure fixe.
import { nextAttentionAt } from "@tamagoshi/rules";
import type { Attention, Balance, Need } from "@tamagoshi/rules";
import type { Snapshot } from "../loop/gameLoop";
import { notificationContent } from "../ui/labels";
import { forPet, recordSent, resolveNeed, shiftHistory } from "./history";
import type { HistoryStore, StoredHistory } from "./history";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export interface ShownNotification {
  title: string;
  body: string;
  /** Une seule notification par besoin à l'écran : la suivante remplace la précédente. */
  tag: string;
  need: Need;
}

export interface NotifierGame {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  readonly currentBalance: Balance;
}

export interface NotifierDeps {
  game: NotifierGame;
  store: HistoryStore;
  permission: () => PermissionState;
  isHidden: () => boolean;
  show: (n: ShownNotification) => void;
}

export class Notifier {
  private history: StoredHistory | null = null;
  private lastSeq = 0;
  private version = 0;
  private cache: { key: string; next: Attention | null } | null = null;

  constructor(private readonly deps: NotifierDeps) {}

  /** Écoute le jeu et la visibilité de la page ; renvoie la fonction d'arrêt. */
  start(): () => void {
    const offGame = this.deps.game.subscribe(() => this.check());
    const onVisibility = (): void => this.check();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    this.check();
    return () => {
      offGame();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /** Historique courant (tests, débogage). */
  current(): StoredHistory | null {
    return this.history;
  }

  check(): void {
    const { game, store } = this.deps;
    const snap = game.getSnapshot();
    const state = snap.state;
    if (!state) return;

    this.history ??= store.load();
    let h = forPet(this.history, state.pet.id);

    // Un besoin résolu retire son entrée, que les notifications soient actives ou non.
    let changed = h !== this.history;
    for (const entry of snap.journal) {
      if (entry.seq <= this.lastSeq) continue;
      if (entry.event.type === "clockAdjusted") {
        // Horloge reculée : l'historique suit la chronologie de l'animal, et la prévision est refaite (commit).
        const next = shiftHistory(h, entry.event.deltaMs);
        if (next !== h) {
          h = next;
          changed = true;
        }
      } else if (entry.event.type === "needResolved") {
        const next = resolveNeed(h, entry.event.need);
        if (next !== h) {
          h = next;
          changed = true;
        }
      }
    }
    for (const entry of snap.journal) this.lastSeq = Math.max(this.lastSeq, entry.seq);
    if (changed) this.commit(h);
    else this.history = h;

    if (!state.settings.notifications || state.pet.life === "flown" || this.deps.permission() !== "granted") {
      this.cache = null;
      return;
    }

    // La prévision simule plusieurs jours : on la refait à chaque action, et au plus une fois par minute.
    const minute = Math.floor(snap.time.nowMs / 60_000);
    const key = `${snap.revision}:${this.version}:${minute}`;
    if (this.cache?.key !== key) {
      this.cache = { key, next: nextAttentionAt(state, snap.time, game.currentBalance, h) };
    }
    const next = this.cache.next;
    if (!next || next.at > snap.time.nowMs || !this.deps.isHidden()) return;

    const { title, body } = notificationContent(next.need, state.pet.name);
    this.commit(recordSent(h, next.need, snap.time.nowMs));
    this.cache = null;
    this.deps.show({ title, body, tag: `need-${next.need}`, need: next.need });
  }

  private commit(h: StoredHistory): void {
    this.history = h;
    this.version++;
    this.deps.store.save(h);
  }
}
