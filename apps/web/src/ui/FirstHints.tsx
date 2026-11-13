// Bulles d'aide du premier lancement : une à la fois, refermables, vues une seule fois.
import { useState } from "react";
import { HINTS, allIds, nextHint, readSeen, writeSeen } from "./hints";

export function FirstHints() {
  const [seen, setSeen] = useState<string[]>(() => readSeen());
  const hint = nextHint(seen);
  if (!hint) return null;

  const done = (ids: string[]): void => {
    setSeen(ids);
    writeSeen(ids);
  };
  const position = HINTS.findIndex((h) => h.id === hint.id) + 1;

  return (
    <aside className="helpbubble" aria-label="Astuce">
      <p>{hint.text}</p>
      <div className="helpbubble-actions">
        <button type="button" className="primary" onClick={() => done([...seen, hint.id])}>
          {position < HINTS.length ? "Compris" : "Merci"}
        </button>
        <button type="button" className="quiet" onClick={() => done(allIds())}>
          Passer l'aide
        </button>
      </div>
    </aside>
  );
}
