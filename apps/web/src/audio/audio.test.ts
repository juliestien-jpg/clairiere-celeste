import { describe, expect, it } from "vitest";
import { createAudioEngine, MAX_SOUND_SECONDS } from "./index";
import type { AudioContextLike, GainLike, OscillatorLike, ParamLike } from "./index";
import { SOUNDS, soundLength } from "./sounds";
import type { SoundName } from "./sounds";

function param(): ParamLike {
  return { value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined };
}

function fakeContext(initial: "running" | "suspended" = "running") {
  const log = { oscillators: [] as OscillatorLike[], started: 0, stopped: 0, resumes: 0, suspends: 0 };
  const ctx = {
    currentTime: 0,
    state: initial as string,
    destination: { connect: () => undefined, disconnect: () => undefined },
    resume() {
      log.resumes++;
      ctx.state = "running";
      return Promise.resolve();
    },
    suspend() {
      log.suspends++;
      ctx.state = "suspended";
      return Promise.resolve();
    },
    createOscillator(): OscillatorLike {
      const osc: OscillatorLike = {
        type: "",
        frequency: param(),
        onended: null,
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => void log.started++,
        stop: () => void log.stopped++,
      };
      log.oscillators.push(osc);
      return osc;
    },
    createGain(): GainLike {
      return { gain: param(), connect: () => undefined, disconnect: () => undefined };
    },
  } satisfies AudioContextLike;
  return { ctx, log };
}

function setup(initial: "running" | "suspended" = "running", hidden = { value: false }) {
  const made = fakeContext(initial);
  let created = 0;
  const engine = createAudioEngine({
    createContext: () => {
      created++;
      return made.ctx;
    },
    isHidden: () => hidden.value,
  });
  return { engine, ...made, created: () => created, hidden };
}

describe("moteur audio", () => {
  it("ne crée aucun contexte tant qu'aucun son n'a été joué", () => {
    const { engine, created } = setup();
    engine.setEnabled(true);
    engine.noteGesture();
    expect(created()).toBe(0);
    expect(engine.hasContext()).toBe(false);
  });

  it("n'émet rien avant un geste du joueur, et ne crée pas de contexte", () => {
    const { engine, created, log } = setup();
    engine.setEnabled(true);
    engine.play("meal");
    expect(created()).toBe(0);
    expect(log.started).toBe(0);
  });

  it("joue après un geste : le contexte naît au premier son", () => {
    const { engine, created, log } = setup();
    engine.setEnabled(true);
    engine.noteGesture();
    engine.play("meal");
    expect(created()).toBe(1);
    expect(log.started).toBeGreaterThan(0);
    engine.play("wake");
    expect(created()).toBe(1);
  });

  it("silence total quand le son est désactivé (par défaut aussi)", () => {
    const { engine, created, log } = setup();
    engine.noteGesture();
    engine.play("meal"); // réglage pas encore connu : désactivé
    engine.setEnabled(true);
    engine.setEnabled(false);
    engine.play("meal");
    expect(created()).toBe(0);
    expect(log.started).toBe(0);
  });

  it("couper le son arrête ce qui sonne encore", () => {
    const { engine, log } = setup();
    engine.setEnabled(true);
    engine.noteGesture();
    engine.play("sleep");
    engine.setEnabled(false);
    expect(log.stopped).toBeGreaterThanOrEqual(log.started);
  });

  it("réveille un contexte suspendu avant de jouer", async () => {
    const { engine, log, ctx } = setup("suspended");
    engine.setEnabled(true);
    engine.noteGesture();
    engine.play("meal");
    expect(log.started).toBe(0); // rien n'est programmé tant que le contexte dort
    await Promise.resolve();
    await Promise.resolve();
    expect(log.resumes).toBe(1);
    expect(ctx.state).toBe("running");
    expect(log.started).toBeGreaterThan(0);
  });

  it("suspend le contexte quand la page est cachée, et ne joue pas pendant ce temps", () => {
    const { engine, log, hidden } = setup();
    engine.setEnabled(true);
    engine.noteGesture();
    engine.play("meal");
    hidden.value = true;
    engine.setHidden(true);
    expect(log.suspends).toBe(1);
    const started = log.started;
    engine.play("wake");
    expect(log.started).toBe(started);
    hidden.value = false;
    engine.setHidden(false);
    expect(log.resumes).toBe(1);
  });

  it("ne rejoue pas le même son en rafale", () => {
    const { engine, log } = setup();
    engine.setEnabled(true);
    engine.noteGesture();
    engine.play("need");
    const n = log.started;
    engine.play("need");
    expect(log.started).toBe(n);
  });
});

describe("partitions", () => {
  const names = Object.keys(SOUNDS) as SoundName[];

  it("chaque son est court (1,2 s au plus), doux et non vide", () => {
    for (const name of names) {
      expect(soundLength(name), name).toBeLessThanOrEqual(MAX_SOUND_SECONDS);
      expect(SOUNDS[name].length, name).toBeGreaterThan(0);
      for (const note of SOUNDS[name]) {
        expect(note.v ?? 0.1, name).toBeLessThanOrEqual(0.15);
        expect(note.f, name).toBeGreaterThan(100);
        expect(note.f, name).toBeLessThan(2500);
      }
    }
  });

  it("tous les sons prévus existent", () => {
    for (const name of ["meal", "snack", "clean", "heal", "play", "pet", "sleep", "wake", "refuse", "hatch", "stage", "need", "weak", "flight", "rebirth"]) {
      expect(names).toContain(name);
    }
  });
});
