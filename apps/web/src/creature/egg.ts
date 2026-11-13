// Œuf (stade « egg ») : le dessin et les poses sont des données (assets/creature/egg/, spec/motion/poses/egg.json,
// états `idle`, `soon` et `hatch`). Ici, seulement le choix de l'état d'après l'âge de l'œuf.
//
// `soon` (fissures dorées, lumière qui filtre, balancement) quand l'éclosion approche : à partir de 60 % de la
// durée du stade œuf, soit la dernière partie de l'attente. La durée vient de l'équilibrage
// (`stages` de spec/balance.json : l'œuf dure jusqu'à `minAgeHours` du stade suivant, 0,05 h = 3 minutes, donc
// `soon` à partir de 1 min 48 s). Une valeur inconnue (progression non fournie) reste en `idle`.

/** Part de la durée du stade œuf à partir de laquelle l'éclosion « approche ». */
export const SOON_FROM = 0.6;

export type EggState = "idle" | "soon" | "hatch";

/** Strictement ce qu'il faut de l'équilibrage : les stades et leur âge minimal. */
export interface StageTable {
  stages: readonly { id: string; minAgeHours: number }[];
}

const MS_PER_HOUR = 3_600_000;

/**
 * Avancement de l'œuf vers l'éclosion, de 0 (né à l'instant) à 1 (l'éclosion), d'après la naissance, l'équilibrage
 * et l'heure courante. Sans stade suivant dans l'équilibrage ou durée nulle : 1.
 */
export function hatchProgress(bornAt: number, balance: StageTable, nowMs: number): number {
  const egg = balance.stages.findIndex((s) => s.id === "egg");
  const next = egg >= 0 ? balance.stages[egg + 1] : undefined;
  if (egg < 0 || !next) return 1;
  const from = (balance.stages[egg] as { minAgeHours: number }).minAgeHours * MS_PER_HOUR;
  const length = next.minAgeHours * MS_PER_HOUR - from;
  if (length <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - bornAt - from) / length));
}

/** État de l'œuf qui attend : `soon` dans la dernière partie de l'attente, `idle` sinon ou sans information. */
export function eggState(progress: number | undefined): Exclude<EggState, "hatch"> {
  return progress !== undefined && progress >= SOON_FROM ? "soon" : "idle";
}
