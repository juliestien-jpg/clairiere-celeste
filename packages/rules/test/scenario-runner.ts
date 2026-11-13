// Lanceur de scénarios de conformité : exécute un fichier de spec/scenarios/ (format décrit
// dans spec/scenarios/README.md) et renvoie la liste des écarts (vide = scénario réussi).
import { createSave, deriveView, migrate, MigrationError, nextAttentionAt, reduce } from "../src/index";
import type { Action, AttentionHistory, Balance, GameEvent, Kind, SaveState } from "../src/index";

export const TOLERANCE = 0.001;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };
type Range = { min?: number; max?: number };

export interface Scenario {
  scenarioVersion: number;
  name: string;
  description: string;
  balanceOverrides?: JsonObject;
  initial: {
    createSave?: { id: string; name: string; seed: number; kind?: Kind; nowMs: number; utcOffsetMin?: number };
    state?: JsonObject;
    patch?: JsonObject;
  };
  steps: JsonObject[];
  forbidEventTypes?: string[];
  expectState?: JsonObject;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Fusion JSON merge patch (RFC 7386) : les objets fusionnent, le reste remplace. */
export function mergePatch(base: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const out: JsonObject = isObject(base) ? { ...base } : {};
  for (const k of Object.keys(patch)) {
    const pv = patch[k] as Json;
    if (pv === null) out[k] = null;
    else out[k] = mergePatch(out[k], pv) as Json;
  }
  return out;
}

/** Lit un chemin « a.b.0.c » dans un objet JSON. */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isObject(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

function isRange(v: unknown): v is Range {
  return isObject(v) && ("min" in v || "max" in v) && Object.keys(v).every((k) => k === "min" || k === "max");
}

/** Compare une valeur attendue à une valeur réelle ; renvoie un message d'écart ou null. */
export function compare(actual: unknown, expected: unknown, subset = false): string | null {
  if (isRange(expected)) {
    if (typeof actual !== "number") return `nombre attendu, obtenu ${JSON.stringify(actual)}`;
    if (expected.min !== undefined && actual < expected.min) return `${actual} < min ${expected.min}`;
    if (expected.max !== undefined && actual > expected.max) return `${actual} > max ${expected.max}`;
    return null;
  }
  if (typeof expected === "number") {
    if (typeof actual !== "number") return `nombre attendu, obtenu ${JSON.stringify(actual)}`;
    return Math.abs(actual - expected) <= TOLERANCE ? null : `${actual} != ${expected} (tolérance ${TOLERANCE})`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return `tableau attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const d = compare(actual[i], expected[i], subset);
      if (d !== null) return `[${i}] ${d}`;
    }
    return null;
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return `objet attendu, obtenu ${JSON.stringify(actual)}`;
    const keys = new Set(subset ? Object.keys(expected) : [...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      const d = compare(actual[k], expected[k], subset);
      if (d !== null) return `.${k} ${d}`;
    }
    return null;
  }
  return actual === expected ? null : `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`;
}

function checkState(state: SaveState, expectState: unknown, where: string, failures: string[]): void {
  if (!isObject(expectState)) return;
  for (const path of Object.keys(expectState)) {
    const d = compare(getPath(state, path), expectState[path]);
    if (d !== null) failures.push(`${where} ${path} : ${d}`);
  }
}

function eventTypeOf(e: GameEvent): string {
  return e.type;
}

export function runScenario(sc: Scenario, defaultBalance: Balance): string[] {
  const failures: string[] = [];
  const balance = (sc.balanceOverrides ? mergePatch(defaultBalance, sc.balanceOverrides) : defaultBalance) as Balance;

  let state: SaveState;
  let offset = 0;
  if (sc.initial.createSave) {
    const c = sc.initial.createSave;
    offset = c.utcOffsetMin ?? 0;
    state = createSave({ id: c.id, name: c.name, seed: c.seed, ...(c.kind === undefined ? {} : { kind: c.kind }) }, { nowMs: c.nowMs, utcOffsetMin: offset }, balance);
  } else if (sc.initial.state) {
    state = sc.initial.state as unknown as SaveState;
  } else {
    return ["initial : createSave ou state requis"];
  }
  if (sc.initial.patch) state = mergePatch(state, sc.initial.patch) as SaveState;

  const seenTypes = new Set<string>();
  sc.steps.forEach((step, i) => {
    const where = `étape ${i + 1}`;
    const nowMs = step["nowMs"];
    if (typeof nowMs !== "number") {
      failures.push(`${where} : nowMs requis`);
      return;
    }
    const time = { nowMs, utcOffsetMin: typeof step["utcOffsetMin"] === "number" ? step["utcOffsetMin"] : offset };

    const query = step["query"];
    if (query === "nextAttentionAt") {
      const history = step["history"] as unknown as AttentionHistory | undefined;
      const d = compare(nextAttentionAt(state, time, balance, history), step["expect"]);
      if (d !== null) failures.push(`${where} nextAttentionAt : ${d}`);
    } else if (query === "deriveView") {
      const d = compare(deriveView(state, time, balance), step["expect"], true);
      if (d !== null) failures.push(`${where} deriveView : ${d}`);
    } else if (query === "migrate") {
      try {
        const migrated = migrate(step["raw"]);
        if (step["expectError"] !== undefined) failures.push(`${where} migrate : erreur ${String(step["expectError"])} attendue`);
        checkState(migrated, step["expectState"], `${where} migrate`, failures);
        state = migrated;
      } catch (e) {
        if (!(e instanceof MigrationError)) failures.push(`${where} migrate : exception inattendue ${String(e)}`);
        else if (e.code !== step["expectError"]) failures.push(`${where} migrate : code ${e.code}, attendu ${String(step["expectError"])}`);
      }
    } else {
      const action = step["action"] as unknown as Action;
      const r = reduce(state, action, time, balance);
      state = r.state;
      const types = r.events.map(eventTypeOf);
      types.forEach((t) => seenTypes.add(t));
      if (step["expectEvents"] !== undefined) {
        const d = compare(r.events, step["expectEvents"]);
        if (d !== null) failures.push(`${where} événements : ${d} ; obtenu ${JSON.stringify(r.events)}`);
      }
      const contains = step["containsEvents"];
      if (Array.isArray(contains)) {
        for (const want of contains) {
          if (!r.events.some((e) => compare(e, want) === null)) {
            failures.push(`${where} : événement ${JSON.stringify(want)} absent ; obtenu ${JSON.stringify(r.events)}`);
          }
        }
      }
      const forbid = step["forbidEventTypes"];
      if (Array.isArray(forbid)) {
        for (const t of forbid) if (types.includes(String(t))) failures.push(`${where} : événement interdit ${String(t)}`);
      }
      checkState(state, step["expectState"], where, failures);
    }
  });

  for (const t of sc.forbidEventTypes ?? []) {
    if (seenTypes.has(t)) failures.push(`événement interdit présent dans le scénario : ${t}`);
  }
  checkState(state, sc.expectState, "état final", failures);
  return failures;
}
