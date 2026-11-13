// Œuf opalescent PROVISOIRE (stade « egg »), dessiné au profil SVG de D4 (path, ellipse, dégradés).
// Il pulse doucement. À remplacer quand le designer livrera l'œuf définitif.
import type { Loop, StateDef, Vec2 } from "./types";

export const EGG_MARKUP = `
<defs>
  <radialGradient id="egg-fill" cx="104" cy="112" r="96" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".35" stop-color="#F3EEFF"/>
    <stop offset=".72" stop-color="#F4A6C6" stop-opacity=".9"/><stop offset="1" stop-color="#8E7CC3"/>
  </radialGradient>
  <radialGradient id="egg-sheen" cx="150" cy="170" r="60" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#A9C8FF" stop-opacity=".6"/><stop offset="1" stop-color="#A9C8FF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="egg-gloss" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity=".9"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
</defs>
<path d="M120 62 C158 62 186 112 186 152 C186 188 158 208 120 208 C82 208 54 188 54 152 C54 112 82 62 120 62 Z" fill="url(#egg-fill)"/>
<path d="M120 62 C158 62 186 112 186 152 C186 188 158 208 120 208 C82 208 54 188 54 152 C54 112 82 62 120 62 Z" fill="url(#egg-sheen)"/>
<ellipse cx="94" cy="110" rx="20" ry="32" transform="rotate(18 94 110)" fill="url(#egg-gloss)"/>
<circle cx="80" cy="156" r="3" fill="#FFFFFF" fill-opacity=".7"/>
<path d="M120 62 C158 62 186 112 186 152 C186 188 158 208 120 208 C82 208 54 188 54 152 C54 112 82 62 120 62 Z" fill="none" stroke="#9C8AD0" stroke-opacity=".85" stroke-width="2.4" stroke-linejoin="round"/>
`;

/** Origines des cibles propres à l'œuf. */
export const EGG_ORIGINS: Record<string, Vec2> = {
  egg: [120, 208],
};

const PULSE: Loop = {
  id: "egg-pulse",
  duration: 3200,
  iterations: "infinite",
  easing: "breath",
  targets: {
    egg: [
      { offset: 0, scale: [1, 1] },
      { offset: 0.5, scale: [1.035, 1.045] },
      { offset: 1, scale: [1, 1] },
    ],
    halo: [
      { offset: 0, scale: [1, 1], opacity: 0.8 },
      { offset: 0.5, scale: [1.08, 1.08], opacity: 1 },
      { offset: 1, scale: [1, 1], opacity: 0.8 },
    ],
  },
};

/** « État » synthétique : mêmes mécanismes que les états de poses.json. */
export const EGG_STATE: StateDef = {
  label: "Œuf",
  cue: "Œuf opalescent qui pulse doucement",
  emblem: null,
  visible: ["shadow", "halo"],
  variants: { halo: "default" },
  static: {},
  rest: null,
  loops: [PULSE],
  particles: [{ preset: "ambient", continuous: true }],
};
