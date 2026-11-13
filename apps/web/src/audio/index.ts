// Sons : l'interface est prête, les sons eux-mêmes viendront plus tard. `play` ne fait rien pour l'instant,
// mais respecte déjà le réglage `settings.sound` (le futur lecteur n'aura qu'à remplacer le corps de `play`).

export type SoundName = "feed" | "clean" | "heal" | "play" | "sleep" | "wake" | "pet" | "hatch" | "flight" | "chime";

let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/** Joue un son nommé. Sans effet pour l'instant (aucun fichier audio) ; sans effet non plus si le son est coupé. */
export function play(name: SoundName): void {
  if (!enabled) return;
  void name;
}
