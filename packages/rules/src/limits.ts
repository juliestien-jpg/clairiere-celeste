// Limites de taille d'une sauvegarde (Annexe A1 de docs/decisions.md). Valeurs de contrat : elles
// protègent l'interface d'une sauvegarde importée démesurée, et sont reprises dans
// `spec/save.schema.json` (`maxLength`, `maxItems`, `maxProperties`).
// Les longueurs se comptent en points de code Unicode (comme `maxLength` de JSON Schema).

export const LIMITS = {
  /** `pet.name` et `album[].name` : longueur maximale après `trim`. */
  nameMaxLength: 40,
  /** Identifiants (`pet.id`, `album[].id`, `rebirth.id`), clés de `cooldowns`, et longueur brute (avant `trim`) d'un nom. */
  textMaxLength: 128,
  /** Entrées maximales de l'album. */
  albumMaxEntries: 1000,
  /** Entrées maximales de `pet.cooldowns`. */
  cooldownsMaxEntries: 32,
} as const;

/** Longueur en points de code Unicode. */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/** Nom valide : texte non vide après `trim`, au plus `nameMaxLength` points de code après `trim`, `textMaxLength` avant. */
export function isValidName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t !== "" && codePointLength(t) <= LIMITS.nameMaxLength && codePointLength(v) <= LIMITS.textMaxLength;
}

/** Identifiant valide : texte non vide d'au plus `textMaxLength` points de code. */
export function isValidId(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && codePointLength(v) <= LIMITS.textMaxLength;
}

/** Nom dépassant la limite (`createSave` ne refuse que l'excès de taille, pas le vide). */
export function isNameTooLong(v: string): boolean {
  return codePointLength(v.trim()) > LIMITS.nameMaxLength || codePointLength(v) > LIMITS.textMaxLength;
}

export function isIdTooLong(v: string): boolean {
  return codePointLength(v) > LIMITS.textMaxLength;
}
