// Couche de particules : un seul <canvas> 2D en surimpression, décoratif (masqué aux lecteurs d'écran).
import { useEffect, useRef } from "react";
import { particles } from "../creature/data";
import { burstChannel, continuousChannel, getAnchor } from "../creature/effects";
import { useReducedMotion } from "../motion/MotionContext";
import { theme } from "../theme/theme";
import { ParticleEngine } from "./engine";

export function ParticleLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const colors: Record<string, string> = {};
    for (const [id, c] of Object.entries(theme.colors)) colors[id] = c.hex;
    const engine = new ParticleEngine({ spec: particles, colors });
    engineRef.current = engine;
    engine.attach(canvas);
    engine.setAnchor(getAnchor);
    engine.setPaused(document.visibilityState === "hidden");
    const onVisibility = (): void => engine.setPaused(document.visibilityState === "hidden");
    const onResize = (): void => engine.resize();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    const offBurst = burstChannel.on((b) => engine.burst(b));
    const offContinuous = continuousChannel.on((ids) => engine.setContinuous(ids));
    return () => {
      offBurst();
      offContinuous();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      engine.detach();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setReduced(reduced);
  }, [reduced]);

  return <canvas ref={canvasRef} className="particles" aria-hidden="true" />;
}
