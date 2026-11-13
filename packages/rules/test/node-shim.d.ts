// Déclarations minimales des API Node utilisées par les tests, pour ne dépendre
// d'aucun paquet de types supplémentaire (devDependencies limitées à typescript et vitest).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function writeFileSync(path: string, data: string): void;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
interface ImportMeta {
  url: string;
}
declare class URL {
  constructor(input: string, base?: string | URL);
}
