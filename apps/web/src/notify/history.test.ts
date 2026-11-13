import { describe, expect, it } from "vitest";
import { createLocalHistoryStore, emptyHistory, forPet, parseHistory, purge, recordSent, resolveNeed } from "./history";

const DAY = 86_400_000;

describe("historique des notifications (D5)", () => {
  it("note un envoi et retire l'entrée d'un besoin résolu", () => {
    let h = emptyHistory("a");
    h = recordSent(h, "satiety", 1000);
    h = recordSent(h, "hygiene", 2000);
    expect(h.sent).toEqual([
      { at: 1000, need: "satiety" },
      { at: 2000, need: "hygiene" },
    ]);
    h = resolveNeed(h, "satiety");
    expect(h.sent).toEqual([{ at: 2000, need: "hygiene" }]);
    expect(resolveNeed(h, "energy")).toBe(h); // rien à retirer : même objet
  });

  it("l'historique d'un autre animal ne compte pas", () => {
    const h = recordSent(emptyHistory("a"), "sick", 5);
    expect(forPet(h, "a")).toBe(h);
    expect(forPet(h, "b")).toEqual({ petId: "b", sent: [] });
    expect(forPet(null, "b")).toEqual({ petId: "b", sent: [] });
  });

  it("purge les entrées de plus de 2 jours mais garde la dernière de chaque besoin", () => {
    const h = {
      petId: "a",
      sent: [
        { at: 0, need: "satiety" as const },
        { at: DAY, need: "satiety" as const },
        { at: 0, need: "sick" as const },
        { at: 3 * DAY, need: "hygiene" as const },
      ],
    };
    const p = purge(h, 3.5 * DAY);
    expect(p.sent).toEqual([
      { at: DAY, need: "satiety" },
      { at: 0, need: "sick" },
      { at: 3 * DAY, need: "hygiene" },
    ]);
  });

  it("lit un historique abîmé sans planter", () => {
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory("pas du json")).toBeNull();
    expect(parseHistory('{"petId":1,"sent":[]}')).toBeNull();
    expect(
      parseHistory('{"petId":"a","sent":[{"at":1,"need":"sick"},{"at":"x","need":"sick"},{"at":2,"need":"inconnu"},null]}'),
    ).toEqual({ petId: "a", sent: [{ at: 1, need: "sick" }] });
  });

  it("le stockage écrit, relit, et survit à un stockage indisponible", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    createLocalHistoryStore(storage).save(recordSent(emptyHistory("a"), "sick", 9));
    expect(createLocalHistoryStore(storage).load()).toEqual({ petId: "a", sent: [{ at: 9, need: "sick" }] });

    const broken = {
      getItem: (): string | null => {
        throw new Error("refusé");
      },
      setItem: (): void => {
        throw new Error("plein");
      },
    };
    const store = createLocalHistoryStore(broken);
    expect(store.load()).toBeNull();
    store.save(emptyHistory("b"));
    expect(store.load()).toEqual({ petId: "b", sent: [] }); // gardé en mémoire pour la page
  });
});
