// Chargement des données partagées : poses (un fichier par espèce, plus l'œuf commun), réactions, particules et
// parties SVG (dossiers `spec/` et `assets/` à la racine du dépôt, hors de apps/web : voir `server.fs.allow`
// dans vite.config.ts).
import type { Kind, Stage } from "@tamagoshi/rules";
import particlesJson from "../../../../spec/motion/particles.json";
import eggPosesJson from "../../../../spec/motion/poses/egg.json";
import feeriquePosesJson from "../../../../spec/motion/poses/feerique.json";
import kawaiiPosesJson from "../../../../spec/motion/poses/kawaii.json";
import reactionsJson from "../../../../spec/motion/reactions.json";
import { GROWN_STAGES, composeEgg, composeStage } from "./parts";
import type { ReactionsSpec } from "./reactions";
import type { ParticlesSpec, PosesSpec } from "./types";

/** Fichiers de poses de chaque espèce (D6) : le bébé à la racine, les stades suivants dans `stages`. */
const rawPoses: Record<Kind, PosesSpec> = {
  kawaii: kawaiiPosesJson as unknown as PosesSpec,
  feerique: feeriquePosesJson as unknown as PosesSpec,
};
export const KINDS: readonly Kind[] = ["kawaii", "feerique"];

/** Poses du stade bébé de chaque espèce (la racine des fichiers, sans `stages`). */
export const posesByKind: Record<Kind, PosesSpec> = {
  kawaii: composeStage(rawPoses.kawaii, "baby"),
  feerique: composeStage(rawPoses.feerique, "baby"),
};

/** Œuf commun aux deux espèces : `poses/egg.json` avec les clés communes du fichier kawaii. */
export const eggPoses: PosesSpec = composeEgg(
  rawPoses.kawaii,
  eggPosesJson as unknown as Pick<PosesSpec, "parts" | "layers" | "states">,
);

const byStage = new Map<string, PosesSpec>();

/**
 * Poses de l'espèce au stade demandé (bébé par défaut). L'œuf est le même pour les deux espèces ; un stade
 * inconnu (sauvegarde étrangère) retombe sur le bébé, une espèce inconnue sur kawaii.
 */
export function posesFor(kind: Kind, stage: Stage = "baby"): PosesSpec {
  if (stage === "egg") return eggPoses;
  const k = rawPoses[kind] ? kind : "kawaii";
  if (!(GROWN_STAGES as readonly string[]).includes(stage)) return posesByKind[k];
  const key = `${k}/${stage}`;
  let s = byStage.get(key);
  if (!s) byStage.set(key, (s = composeStage(rawPoses[k], stage)));
  return s;
}

/** Tous les jeux de poses d'une espèce (bébé, enfant, adolescent, adulte), pour les contrôles de cohérence. */
export function allPosesOf(kind: Kind): PosesSpec[] {
  return (["baby", ...GROWN_STAGES] as Stage[]).map((s) => posesFor(kind, s));
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
