// Déclarations minimales des modules Node utilisés par vite.config.ts et les tests (le projet n'embarque pas @types/node).
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: "utf-8"): string;
  export function existsSync(path: string | URL): boolean;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
  export function writeFileSync(path: string, data: string): void;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
declare module "node:vm" {
  export function runInNewContext(code: string, sandbox: object): unknown;
}
