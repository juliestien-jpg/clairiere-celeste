// Exécute tous les fichiers de spec/scenarios/*.json (vecteurs de conformité, D1).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultBalance } from "../src/index";
import { runScenario } from "./scenario-runner";
import type { Scenario } from "./scenario-runner";

const dir = fileURLToPath(new URL("../../../spec/scenarios/", import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

/** Un scénario par garantie de D3 doit exister : G1, G2, G3, G4, renaissance, refus, horloge qui recule. */
const REQUIRED = [
  "nuit-10h-initial",
  "nuit-10h-bornes",
  "weekend-48h-pleines",
  "delai-affaiblie-envol",
  "plafond-168h",
  "envol-puis-renaissance",
  "actions-refusees",
  "horloge-recule",
];

describe("scénarios de conformité (spec/scenarios)", () => {
  it("les scénarios obligatoires sont présents", () => {
    const names = files.map((f) => f.replace(/\.json$/, ""));
    for (const r of REQUIRED) expect(names, `scénario manquant : ${r}`).toContain(r);
  });

  it.each(files)("%s", (file) => {
    const sc = JSON.parse(readFileSync(dir + file, "utf8")) as Scenario;
    expect(sc.scenarioVersion).toBe(1);
    expect(file).toBe(sc.name + ".json");
    const failures = runScenario(sc, defaultBalance);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
