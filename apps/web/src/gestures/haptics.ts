// Retour haptique léger : seulement si le navigateur sait vibrer, jamais en mouvement réduit (D4).
export function haptic(ms: number, reduced: boolean): void {
  if (reduced || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Vibration refusée par le navigateur : sans importance.
  }
}
