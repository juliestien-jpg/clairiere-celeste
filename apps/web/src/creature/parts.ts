// Choix des parties SVG d'une créature : pour une espèce et un état, quelles parties se dessinent, dans
// quel ordre et avec quelle variante (poses/<espèce>.json). Fonction pure, testée ; Creature.tsx ne fait
// que poser le résultat dans le SVG.
import type { PosesSpec, StateDef } from "./types";

export interface LayerPart {
  part: string;
  variant: string;
  /** Fichier relatif à `assets/`. */
  file: string;
}

/** Parties visibles de l'état, dans l'ordre de `layers` ; une partie sans fichier est ignorée. */
export function layerParts(poses: PosesSpec, def: StateDef): LayerPart[] {
  const out: LayerPart[] = [];
  for (const part of poses.layers) {
    if (!def.visible.includes(part)) continue;
    const variants = poses.parts[part]?.variants ?? {};
    const variant = def.variants[part] ?? Object.keys(variants)[0] ?? "default";
    const file = variants[variant];
    if (!file) continue;
    out.push({ part, variant, file });
  }
  return out;
}

/** Stades dessinés après le bébé : leurs parties et leurs états sont dans `stages` du fichier de l'espèce. */
export const GROWN_STAGES = ["child", "teen", "adult"] as const;

/**
 * Poses d'un stade (D4, spec/motion/README.md) : le fichier de l'espèce décrit le bébé à sa racine et les stades
 * suivants dans `stages` ; les clés communes (courbes, emblèmes, transitions…) restent à la racine.
 * `{ ...racine, ...stages[stade] }`, sans `stages`. Le bébé (ou un stade inconnu) est la racine telle quelle.
 */
export function composeStage(root: PosesSpec, stage: string): PosesSpec {
  const { stages, ...rest } = root;
  const own = stages?.[stage];
  if (!own) return rest as PosesSpec;
  return { ...rest, ...own, stage } as PosesSpec;
}

/** Œuf : commun aux deux espèces, ses poses reprennent les clés communes du fichier kawaii. */
export function composeEgg(common: PosesSpec, egg: Pick<PosesSpec, "parts" | "layers" | "states">): PosesSpec {
  const { stages: _stages, parts: _p, layers: _l, states: _s, ...rest } = common;
  return { ...rest, ...egg, stage: "egg", kind: "egg" } as PosesSpec;
}

/** Nom d'un préréglage de particules d'un état : `{kind}` devient l'espèce (ex. `hatch-{kind}`). */
export function resolvePreset(preset: string, kind: string): string {
  return preset.replace("{kind}", kind);
}
