import { createSave, defaultBalance } from "@tamagoshi/rules";
import type { GameEvent, SaveState } from "@tamagoshi/rules";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../loop/gameLoop";
import { createLocalHistoryStore } from "./history";
import { Notifier } from "./notifier";
import type { PermissionState, ShownNotification } from "./notifier";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 13, 12, 0, 0); // midi UTC, décalage 0 : hors heures calmes

function makeState(notifications = true): SaveState {
  const s = createSave({ id: "pet-1", name: "Lumi", seed: 7 }, { nowMs: START, utcOffsetMin: 0 }, defaultBalance);
  return { ...s, settings: { ...s.settings, notifications } };
}

function setup(opts: { permission?: PermissionState; hidden?: boolean; notifications?: boolean } = {}) {
  let snap: Snapshot = {
    ready: true,
    state: makeState(opts.notifications ?? true),
    time: { nowMs: START, utcOffsetMin: 0 },
    view: null,
    speed: 1,
    paused: false,
    journal: [],
    notice: null,
    loadError: null,
    loadErrorCode: null,
    readOnly: false,
    saveError: null,
    revision: 0,
  };
  const shown: ShownNotification[] = [];
  let hidden = opts.hidden ?? true;
  const store = createLocalHistoryStore({ getItem: () => null, setItem: () => {} });
  const notifier = new Notifier({
    game: { getSnapshot: () => snap, subscribe: () => () => {}, currentBalance: defaultBalance },
    store,
    permission: () => opts.permission ?? "granted",
    isHidden: () => hidden,
    show: (n) => shown.push(n),
  });
  return {
    notifier,
    shown,
    store,
    setHidden: (v: boolean) => {
      hidden = v;
    },
    at: (ms: number) => {
      snap = { ...snap, time: { nowMs: START + ms, utcOffsetMin: 0 } };
      notifier.check();
    },
    pushEvent: (event: GameEvent, seq: number) => {
      snap = { ...snap, journal: [{ seq, atMs: snap.time.nowMs, event }, ...snap.journal], revision: snap.revision + 1 };
      notifier.check();
    },
  };
}

describe("Notifier (page ouverte, D5)", () => {
  it("n'envoie rien tant qu'aucun besoin n'est apparu", () => {
    const t = setup();
    t.at(0);
    t.at(10 * 60_000);
    expect(t.shown).toEqual([]);
  });

  it("envoie une notification douce quand le besoin apparaît, une seule fois, et note l'envoi", () => {
    const t = setup();
    t.at(0);
    for (let h = 1; h <= 30 && t.shown.length === 0; h++) t.at(h * HOUR);
    expect(t.shown).toHaveLength(1);
    const n = t.shown[0];
    expect(n?.title).toBe("Clairière céleste");
    expect(n?.body).toMatch(/Lumi/);
    expect(n?.body).not.toMatch(/faute|abandon|mort|négligen/i);
    expect(n?.tag).toBe(`need-${n?.need}`);
    expect(t.notifier.current()?.sent.map((e) => e.need)).toEqual([n?.need]);
    // Pas de doublon dans les minutes qui suivent (espacement de l'historique).
    const hourWhenSent = t.shown.length;
    t.at(31 * HOUR);
    t.at(31 * HOUR + 60_000);
    // Un autre besoin peut légitimement apparaître plus tard, mais jamais le même, ni deux à moins de 3 h d'intervalle.
    expect(t.shown.length).toBeGreaterThanOrEqual(hourWhenSent);
    const needs = t.shown.map((s) => s.need);
    expect(new Set(needs).size).toBe(needs.length);
  });

  it("n'affiche rien si le réglage est coupé, la permission absente ou la page visible", () => {
    for (const opts of [{ notifications: false }, { permission: "denied" as const }, { permission: "default" as const }, { hidden: false }]) {
      const t = setup(opts);
      t.at(0);
      for (let h = 1; h <= 30; h++) t.at(h * HOUR);
      expect(t.shown, JSON.stringify(opts)).toEqual([]);
    }
  });

  it("une page visible n'est pas dérangée, mais le besoin est signalé dès qu'elle est cachée", () => {
    const t = setup({ hidden: false });
    t.at(0);
    for (let h = 1; h <= 30; h++) t.at(h * HOUR);
    expect(t.shown).toEqual([]);
    t.setHidden(true);
    t.at(31 * HOUR);
    expect(t.shown).toHaveLength(1);
  });

  it("un besoin résolu retire son entrée", () => {
    const t = setup();
    t.at(0);
    for (let h = 1; h <= 30 && t.shown.length === 0; h++) t.at(h * HOUR);
    const need = t.shown[0]?.need;
    expect(need).toBeDefined();
    if (!need) return;
    t.setHidden(false); // la page est visible : le besoin encore actif ne repart pas aussitôt
    t.pushEvent({ type: "needResolved", need }, 1);
    expect(t.notifier.current()?.sent.some((e) => e.need === need)).toBe(false);
  });

  it("une horloge reculée (clockAdjusted) décale d'autant les envois de l'historique", () => {
    const t = setup();
    t.at(0);
    for (let h = 1; h <= 30 && t.shown.length === 0; h++) t.at(h * HOUR);
    const before = t.notifier.current()?.sent.map((e) => e.at) ?? [];
    expect(before.length).toBeGreaterThan(0);
    t.setHidden(false);
    t.pushEvent({ type: "clockAdjusted", deltaMs: -HOUR }, 1);
    expect(t.notifier.current()?.sent.map((e) => e.at)).toEqual(before.map((at) => at - HOUR));
  });

  it("l'historique d'un animal précédent est ignoré", () => {
    const t = setup();
    t.store.save({ petId: "ancien", sent: [{ at: START, need: "satiety" }] });
    t.at(0);
    expect(t.notifier.current()).toEqual({ petId: "pet-1", sent: [] });
  });
});
