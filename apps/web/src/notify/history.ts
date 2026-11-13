// Historique des notifications envoyées (D5), tenu hors de la sauvegarde et passé à `nextAttentionAt` pour
// l'espacement, le plafond par jour et les heures calmes. Fonctions pures + lecture/écriture localStorage.
import type { AttentionHistory, Need } from "@tamagoshi/rules";

export interface StoredHistory extends AttentionHistory {
  /** Animal concerné : l'historique d'un animal précédent ne compte pas pour le suivant. */
  petId: string;
}

const NEEDS: readonly string[] = ["satiety", "hygiene", "happiness", "energy", "sick", "weak"];
const MAX_AGE_MS = 2 * 86_400_000;
export const HISTORY_KEY = "tamagoshi.attentionHistory.v1";

export function emptyHistory(petId: string): StoredHistory {
  return { petId, sent: [] };
}

/** L'historique de cet animal, ou un historique vide s'il appartient à un autre. */
export function forPet(h: StoredHistory | null, petId: string): StoredHistory {
  return h && h.petId === petId ? h : emptyHistory(petId);
}

/** Note un envoi, puis purge les entrées de plus de 2 jours (en gardant la dernière de chaque besoin). */
export function recordSent(h: StoredHistory, need: Need, at: number): StoredHistory {
  return purge({ ...h, sent: [...h.sent, { at, need }] }, at);
}

/** L'horloge de l'appareil a reculé de `deltaMs` (négatif) : les envois passés sont décalés d'autant. */
export function shiftHistory(h: StoredHistory, deltaMs: number): StoredHistory {
  if (deltaMs === 0 || h.sent.length === 0) return h;
  return { ...h, sent: h.sent.map((e) => ({ ...e, at: e.at + deltaMs })) };
}

/** Retire les entrées d'un besoin résolu (événement `needResolved`). */
export function resolveNeed(h: StoredHistory, need: Need): StoredHistory {
  if (!h.sent.some((e) => e.need === need)) return h;
  return { ...h, sent: h.sent.filter((e) => e.need !== need) };
}

export function purge(h: StoredHistory, nowMs: number, maxAgeMs = MAX_AGE_MS): StoredHistory {
  const latest = new Map<Need, number>();
  for (const e of h.sent) latest.set(e.need, Math.max(latest.get(e.need) ?? -Infinity, e.at));
  const sent = h.sent.filter((e) => nowMs - e.at <= maxAgeMs || latest.get(e.need) === e.at);
  return sent.length === h.sent.length ? h : { ...h, sent };
}

/** Lecture tolérante : tout ce qui n'est pas un historique valide donne `null`. */
export function parseHistory(text: string | null): StoredHistory | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o["petId"] !== "string" || !Array.isArray(o["sent"])) return null;
    const sent: StoredHistory["sent"] = [];
    for (const e of o["sent"] as unknown[]) {
      if (typeof e !== "object" || e === null) continue;
      const { at, need } = e as Record<string, unknown>;
      if (typeof at === "number" && Number.isFinite(at) && typeof need === "string" && NEEDS.includes(need)) {
        sent.push({ at, need: need as Need });
      }
    }
    return { petId: o["petId"], sent };
  } catch {
    return null;
  }
}

export interface HistoryStore {
  load(): StoredHistory | null;
  save(h: StoredHistory): void;
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** localStorage ; si le stockage est indisponible, l'historique vit seulement le temps de la page. */
export function createLocalHistoryStore(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): HistoryStore {
  let memory: StoredHistory | null = null;
  return {
    load() {
      if (memory) return memory;
      try {
        return parseHistory(storage?.getItem(HISTORY_KEY) ?? null);
      } catch {
        return null;
      }
    },
    save(h) {
      memory = h;
      try {
        storage?.setItem(HISTORY_KEY, JSON.stringify(h));
      } catch {
        // Stockage plein ou refusé : l'historique en mémoire suffit pour cette page.
      }
    },
  };
}
