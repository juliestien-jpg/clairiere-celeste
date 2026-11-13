// Générateur aléatoire mulberry32 (D1). L'état est un entier non signé de 32 bits,
// stocké dans `pet.rng`. Tous les masquages 32 bits sont explicites pour que le port
// Dart (entiers 64 bits) donne exactement les mêmes valeurs.

/** Un tirage : renvoie la valeur dans [0, 1) et le nouvel état. */
export function nextRandom(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) >>> 0; // nouvel état, modulo 2^32
  let t = Math.imul(a ^ (a >>> 15), a | 1) >>> 0; // produit modulo 2^32
  const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0; // somme modulo 2^32
  t = (t ^ u) >>> 0;
  const out = (t ^ (t >>> 14)) >>> 0;
  return { value: out / 4294967296, state: a };
}

/** Normalise une graine en état valide (entier non signé 32 bits). */
export function seedToState(seed: number): number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0; // modulo 2^32, y compris pour les valeurs négatives ou très grandes
}

/**
 * Tirage de l'espèce (D6). Exactement UN tirage `nextRandom` à partir de l'état de la graine
 * (`seedToState(seed)`), puis `pick = floor(value * total)` où `total` est la somme des poids
 * entiers ; on parcourt `kinds` dans l'ordre du tableau en cumulant les poids et on retient la
 * première entrée dont le cumul dépasse `pick`. Renvoie l'espèce et l'état du générateur après
 * ce tirage (valeur de `pet.rng` à la naissance). Arithmétique de base uniquement (D1).
 */
export function drawKind(seedState: number, kinds: readonly { id: string; weight: number }[]): { id: string; state: number } {
  const { value, state } = nextRandom(seedState);
  let total = 0;
  for (const k of kinds) total += k.weight;
  const pick = Math.floor(value * total);
  let cumul = 0;
  for (const k of kinds) {
    cumul += k.weight;
    if (pick < cumul) return { id: k.id, state };
  }
  const last = kinds[kinds.length - 1];
  return { id: last === undefined ? "" : last.id, state }; // inatteignable avec une balance valide
}
