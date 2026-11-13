import { createContext, useContext } from "react";

/** Vrai si le mouvement est réduit (préférence du système ou réglage de l'application). */
export const MotionContext = createContext<boolean>(false);

export function useReducedMotion(): boolean {
  return useContext(MotionContext);
}
