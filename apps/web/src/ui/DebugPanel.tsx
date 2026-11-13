// Panneau de débogage : observer le jeu sans attendre des heures. Visible en dev ou avec ?debug.
import { useMemo, useState } from "react";
import { nextAttentionAt } from "@tamagoshi/rules";
import type { GameLoop, Snapshot } from "../loop/gameLoop";
import { exportFileName } from "../storage/saveStore";
import { GAUGE_LABEL, GAUGE_ORDER, KIND_LABEL, describeJournalEvent } from "./labels";

const SPEEDS = [1, 60, 600, 3600] as const;
const JUMPS: { label: string; ms: number }[] = [
  { label: "+1 h", ms: 3_600_000 },
  { label: "+10 h", ms: 36_000_000 },
  { label: "+48 h", ms: 172_800_000 },
  { label: "+4 jours", ms: 345_600_000 },
];

export function isDebugVisible(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

export function DebugPanel({ game, snap }: { game: GameLoop; snap: Snapshot }) {
  const [message, setMessage] = useState<string | null>(null);
  const { state, view, time } = snap;

  // Le calcul simule jusqu'à 7 jours : on ne le refait que quand l'état ou la minute virtuelle change.
  const minute = Math.floor(time.nowMs / 60_000);
  const attention = useMemo(
    () => (state ? nextAttentionAt(state, { nowMs: minute * 60_000, utcOffsetMin: time.utcOffsetMin }, game.currentBalance) : null),
    [state, minute, time.utcOffsetMin, game],
  );

  function download(): void {
    const blob = game.exportBlob();
    if (!blob || !state) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(state);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      await game.importFile(file);
      setMessage("Sauvegarde importée.");
    } catch (e) {
      setMessage(`Import impossible : ${e instanceof Error ? e.message : "fichier illisible"}`);
    }
  }

  async function onReset(): Promise<void> {
    if (!window.confirm("Effacer la sauvegarde et revenir à l'écran de création ?")) return;
    await game.reset();
    setMessage("Sauvegarde effacée.");
  }

  return (
    <aside className="debug" aria-label="Panneau de débogage">
      <details open>
        <summary>Débogage</summary>

        <section>
          <h2>Temps</h2>
          <p data-testid="virtual-time">
            Heure virtuelle : <time>{fmtDate(time.nowMs)}</time> (×{snap.speed}
            {snap.paused ? ", en pause" : ""}, décalage {time.utcOffsetMin} min)
          </p>
          <div className="row" role="group" aria-label="Vitesse">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={!snap.paused && snap.speed === s} onClick={() => { game.setPaused(false); game.setSpeed(s); }}>
                ×{s}
              </button>
            ))}
            <button type="button" aria-pressed={snap.paused} onClick={() => game.setPaused(!snap.paused)}>
              Pause
            </button>
          </div>
          <div className="row" role="group" aria-label="Sauts de temps">
            {JUMPS.map((j) => (
              <button key={j.label} type="button" onClick={() => game.jump(j.ms)}>
                {j.label}
              </button>
            ))}
          </div>
        </section>

        {state && view && (
          <>
            <section>
              <h2>Espèce</h2>
              <p data-testid="debug-kind">
                {KIND_LABEL[state.pet.kind]} (<code>{state.pet.kind}</code>), vue : <code>{view.kind}</code>
              </p>
            </section>
            <section>
              <h2>Jauges</h2>
              <table>
                <tbody>
                  {GAUGE_ORDER.map((g) => (
                    <tr key={g}>
                      <th scope="row">{GAUGE_LABEL[g]}</th>
                      <td>{state.pet.gauges[g].toFixed(2)}</td>
                      <td>{view.gaugeLevels[g]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h2>nextAttentionAt</h2>
              <pre>{attention ? `${attention.need} à ${fmtDate(attention.at)} (dans ${Math.round((attention.at - time.nowMs) / 60_000)} min virtuelles)` : "null"}</pre>
            </section>
            <section>
              <h2>deriveView</h2>
              <pre>{JSON.stringify(view, null, 2)}</pre>
            </section>
            <section>
              <h2>SaveState</h2>
              <pre>{JSON.stringify(state, null, 2)}</pre>
            </section>
          </>
        )}

        <section>
          <h2>Journal ({snap.journal.length})</h2>
          <ol className="journal" reversed>
            {snap.journal.map((j) => (
              <li key={j.seq}>
                <time>{fmtDate(j.atMs)}</time> {describeJournalEvent(j.event)}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Sauvegarde</h2>
          <div className="row">
            <button type="button" onClick={download} disabled={!state}>
              Exporter
            </button>
            <label className="file-button">
              Importer
              <input type="file" accept=".json,application/json" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => void onReset()}>
              Réinitialiser
            </button>
          </div>
          {snap.saveError && <p role="alert">Écriture impossible : {snap.saveError}</p>}
          {message && <p role="status">{message}</p>}
        </section>
      </details>
    </aside>
  );
}
