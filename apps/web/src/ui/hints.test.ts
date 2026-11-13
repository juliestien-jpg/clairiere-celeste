import { describe, expect, it } from "vitest";
import { HINTS, allIds, nextHint, readSeen, resetSeen, writeSeen } from "./hints";
import type { KeyValueStorage } from "./hints";

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("bulles d'aide du premier lancement", () => {
  it("montre les bulles une à une, puis plus jamais", () => {
    const store = memory();
    expect(nextHint(readSeen(store))?.id).toBe(HINTS[0]?.id);
    writeSeen([HINTS[0]?.id ?? ""], store);
    expect(nextHint(readSeen(store))?.id).toBe(HINTS[1]?.id);
    writeSeen(allIds(), store);
    expect(nextHint(readSeen(store))).toBeNull();
  });

  it("« Revoir les bulles d'aide » les remet à zéro", () => {
    const store = memory();
    writeSeen(allIds(), store);
    resetSeen(store);
    expect(nextHint(readSeen(store))?.id).toBe(HINTS[0]?.id);
  });

  it("tolère un stockage vide, abîmé ou indisponible", () => {
    const store = memory();
    store.data.set("tamagoshi.hints.v1", "{pas du json");
    expect(readSeen(store)).toEqual([]);
    expect(readSeen(null)).toEqual([]);
    expect(() => writeSeen(["a"], null)).not.toThrow();
    expect(() => resetSeen(null)).not.toThrow();
  });

  it("les textes sont courts et doux", () => {
    for (const h of HINTS) expect(h.text.length).toBeLessThan(70);
  });
});
