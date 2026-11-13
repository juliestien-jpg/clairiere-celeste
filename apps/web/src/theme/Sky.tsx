// Ciel de fond selon l'heure locale virtuelle : quatre dégradés qui se fondent, étoiles qui scintillent
// lentement (fixes en mouvement réduit). Décor pur : masqué aux lecteurs d'écran.
import { memo, useEffect, useMemo } from "react";
import type { SkyId } from "../creature/types";
import { applySkyVars, localMinutes, skyAt, skyGradient, theme } from "./theme";

const IDS: readonly SkyId[] = ["dawn", "day", "dusk", "night"];

interface Star {
  x: number;
  y: number;
  r: number;
  color: string;
  delay: number;
  duration: number;
}

/** Étoiles à graine fixe : le même ciel à chaque lancement. */
function makeStars(): Star[] {
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const palette = [theme.colors["firefly-gold"]?.hex, theme.colors["moon-blue"]?.hex, theme.colors["moonmilk-cream"]?.hex];
  const stars: Star[] = [];
  for (let i = 0; i < 64; i++) {
    const c = rnd() < 0.2 ? palette[0] : rnd() < 0.5 ? palette[1] : palette[2];
    stars.push({
      x: Math.round(rnd() * 1000),
      y: Math.round(rnd() * 640),
      r: 0.8 + rnd() * 1.6,
      color: c ?? "#FFF6E9",
      delay: rnd() * 5,
      duration: 4 + rnd() * 3, // cycles de 4 à 7 s : jamais plus de 3 éclats par seconde
    });
  }
  return stars;
}

const StarField = memo(function StarField() {
  const stars = useMemo(makeStars, []);
  return (
    <svg className="starfield" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" focusable="false">
      {stars.map((s, i) => (
        <circle
          key={i}
          className="twinkle"
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={s.color}
          style={{ animationDelay: `-${s.delay.toFixed(1)}s`, animationDuration: `${s.duration.toFixed(1)}s` }}
        />
      ))}
    </svg>
  );
});

export function Sky({ nowMs, utcOffsetMin }: { nowMs: number; utcOffsetMin: number }) {
  const mix = skyAt(localMinutes(nowMs, utcOffsetMin));
  useEffect(() => {
    applySkyVars(mix.current);
  }, [mix.current]);

  return (
    <div className="skybg" aria-hidden="true">
      {IDS.map((id) => {
        const isCurrent = id === mix.current;
        const isNeighbor = id === mix.neighbor;
        const opacity = isCurrent ? 1 - mix.neighborShare : isNeighbor ? 1 : 0;
        return (
          <div
            key={id}
            className="skylayer"
            data-sky={id}
            style={{ background: skyGradient(theme.skies[id]), opacity, zIndex: isCurrent ? 2 : isNeighbor ? 1 : 0 }}
          />
        );
      })}
      <div className="starlayer" style={{ opacity: mix.stars }}>
        <StarField />
      </div>
    </div>
  );
}
