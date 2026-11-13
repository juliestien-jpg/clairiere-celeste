// Chargement des données partagées : poses (une par espèce), réactions, particules et parties SVG
// (dossiers `spec/` et `assets/` à la racine du dépôt, hors de apps/web : voir `server.fs.allow` dans vite.config.ts).
import type { Kind } from "@tamagoshi/rules";
import particlesJson from "../../../../spec/motion/particles.json";
import feeriquePosesJson from "../../../../spec/motion/poses/feerique.json";
import kawaiiPosesJson from "../../../../spec/motion/poses/kawaii.json";
import reactionsJson from "../../../../spec/motion/reactions.json";
import type { ReactionsSpec } from "./reactions";
import type { ParticlesSpec, PosesSpec } from "./types";

/** Poses et parties de chaque espèce (D6) : même format, mêmes états, parties propres à l'espèce. */
export const posesByKind: Record<Kind, PosesSpec> = {
  kawaii: kawaiiPosesJson as unknown as PosesSpec,
  feerique: feeriquePosesJson as unknown as PosesSpec,
};
export const KINDS: readonly Kind[] = ["kawaii", "feerique"];

/** Poses de l'espèce (repli sur kawaii pour une valeur inconnue venue d'une sauvegarde étrangère). */
export function posesFor(kind: Kind): PosesSpec {
  return posesByKind[kind] ?? posesByKind.kawaii;
}

export const reactions = reactionsJson as unknown as ReactionsSpec;
export const particles = particlesJson as unknown as ParticlesSpec;

const rawSvg = import.meta.glob("../../../../assets/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Contenu SVG (sans l'élément racine) d'un fichier désigné comme dans poses/*.json (« creature/kawaii/baby/body.svg »). */
const inner = new Map<string, string>();
for (const [path, text] of Object.entries(rawSvg)) {
  const key = path.slice(path.indexOf("/assets/") + "/assets/".length);
  inner.set(key, text.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""));
}

export function svgInner(file: string): string {
  const s = inner.get(file);
  if (s === undefined) throw new Error(`fichier SVG introuvable : ${file}`);
  return s;
}
