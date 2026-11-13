import { describe, expect, it } from "vitest";
import { VirtualClock } from "./clock";

function setup() {
  let real = 1_000_000;
  const clock = new VirtualClock(() => real);
  return { clock, advance: (ms: number) => (real += ms) };
}

describe("VirtualClock", () => {
  it("suit l'heure réelle à vitesse ×1", () => {
    const { clock, advance } = setup();
    const t0 = clock.now();
    advance(5000);
    expect(clock.now() - t0).toBe(5000);
  });

  it("multiplie le temps écoulé par le facteur de vitesse", () => {
    const { clock, advance } = setup();
    clock.setSpeed(3600);
    const t0 = clock.now();
    advance(1000);
    expect(clock.now() - t0).toBe(3_600_000);
  });

  it("un changement de vitesse ne rétroagit pas sur le passé", () => {
    const { clock, advance } = setup();
    const t0 = clock.now();
    advance(1000);
    clock.setSpeed(60);
    advance(1000);
    expect(clock.now() - t0).toBe(1000 + 60_000);
  });

  it("la pause fige l'heure virtuelle, la reprise repart sans saut", () => {
    const { clock, advance } = setup();
    clock.pause();
    const frozen = clock.now();
    advance(10_000);
    expect(clock.now()).toBe(frozen);
    clock.resume();
    advance(2000);
    expect(clock.now() - frozen).toBe(2000);
  });

  it("un saut ajoute un décalage, même en pause", () => {
    const { clock, advance } = setup();
    const t0 = clock.now();
    clock.jump(3_600_000);
    expect(clock.now() - t0).toBe(3_600_000);
    clock.pause();
    clock.jump(1000);
    advance(5000);
    expect(clock.now() - t0).toBe(3_601_000);
    expect(clock.offsetMs).toBe(clock.now() - 1_005_000);
  });

  it("refuse un facteur de vitesse invalide", () => {
    const { clock } = setup();
    expect(() => clock.setSpeed(0)).toThrow(RangeError);
    expect(() => clock.setSpeed(Number.NaN)).toThrow(RangeError);
  });

  it("renvoie toujours un entier", () => {
    let real = 0;
    const clock = new VirtualClock(() => real);
    clock.setSpeed(0.3333);
    real = 1234;
    expect(Number.isInteger(clock.now())).toBe(true);
  });
});
