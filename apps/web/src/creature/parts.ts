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
