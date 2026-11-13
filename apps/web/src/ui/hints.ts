// Bulles d'aide du premier lancement : légères, refermables, montrées une seule fois (mémorisées localement).

export interface Hint {
  id: string;
  text: string;
}

export const HINTS: readonly Hint[] = [
  { id: "feed", text: "Glisse le repas jusqu'à sa bouche pour le nourrir." },
  { id: "wash", text: "Choisis l'éponge, puis frotte doucement pour le laver." },
  { id: "pet", text: "Caresse-le du doigt : il adore ça." },
  { id: "vials", text: "Les fioles du haut disent comment il se sent." },
];

export const HINTS_STORAGE_NAME = "tamagoshi.hints.v1";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Identifiants déjà vus (ou tous, si le joueur a passé l'aide). */
export function readSeen(storage: KeyValueStorage | null = safeStorage()): string[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(HINTS_STORAGE_NAME) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeSeen(ids: readonly string[], storage: KeyValueStorage | null = safeStorage()): void {
  try {
    storage?.setItem(HINTS_STORAGE_NAME, JSON.stringify(ids));
  } catch {
    // Stockage indisponible : les bulles reviendront au prochain chargement, sans autre conséquence.
  }
}

/** Prochaine bulle à montrer, ou `null` quand tout a été vu. */
export function nextHint(seen: readonly string[], hints: readonly Hint[] = HINTS): Hint | null {
  return hints.find((h) => !seen.includes(h.id)) ?? null;
}

/** « Passer l'aide » : toutes les bulles sont considérées comme vues. */
export function allIds(hints: readonly Hint[] = HINTS): string[] {
  return hints.map((h) => h.id);
}

/** Pour « Revoir les bulles d'aide » dans les réglages. */
export function resetSeen(storage: KeyValueStorage | null = safeStorage()): void {
  try {
    storage?.removeItem(HINTS_STORAGE_NAME);
  } catch {
    // Rien à faire.
  }
}
