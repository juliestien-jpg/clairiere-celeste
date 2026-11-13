import { describe, expect, it } from "vitest";
import { isSoundEnabled, play, setSoundEnabled } from "./index";

describe("module audio", () => {
  it("play ne fait rien (pour l'instant) et ne plante jamais, son coupé ou non", () => {
    expect(() => play("feed")).not.toThrow();
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(() => play("chime")).not.toThrow();
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });
});
