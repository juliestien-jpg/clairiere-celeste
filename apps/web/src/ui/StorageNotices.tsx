// Messages doux autour de la sauvegarde : écriture impossible, partie en lecture seule, sauvegarde illisible.
// Rien ici n'efface une sauvegarde sans demande explicite, et jamais quand elle vient d'une version plus récente.
import { useEffect, useRef, useState } from "react";
import type { GameLoop, Snapshot } from "../loop/gameLoop";
import { reloadForNewVersion } from "../pwa/register";
import { exportFileName } from "../storage/saveStore";
import { RAW_EXPORT_FILE_NAME, downloadBlob } from "./download";

export const NEWER_VERSION_TEXT =
  "Une version plus récente du jeu est nécessaire pour lire cette sauvegarde. Elle est en sécurité : rien n'a été effacé.";

/** Texte du bandeau selon l'état du stockage, ou `null` si tout va bien. */
export function storageBarText(snap: Pick<Snapshot, "saveError" | "readOnly" | "loadErrorCode">): string | null {
  if (snap.readOnly && snap.loadErrorCode === "unsupportedVersion") {
    return "Une version plus récente du jeu est nécessaire : cette partie n'est pas enregistrée, pour ne pas abîmer la sauvegarde de l'appareil.";
  }
  if (snap.readOnly) {
    return "La sauvegarde de l'appareil n'a pas pu être lue : cette partie n'est pas enregistrée, pour ne pas l'abîmer. Exporte-la pour ne rien perdre.";
  }
  if (snap.saveError) return "La clairière n'arrive pas à garder ta partie : exporte-la pour ne rien perdre.";
  return null;
}

/** Bandeau quand la partie en cours ne peut pas être gardée : écriture en échec, ou lecture seule. */
export function StorageBar({ game, snap }: { game: GameLoop; snap: Snapshot }) {
  const { state } = snap;
  const [message, setMessage] = useState<string | null>(null);
  const text = storageBarText(snap);
  if (!state || text === null) return null;

  function exportGame(): void {
    const blob = game.exportBlob();
    if (!blob || !state) return;
    downloadBlob(blob, exportFileName(state));
    setMessage("Ta partie est exportée dans un fichier.");
  }

  return (
    <div className="updatebar" role="status" data-testid="storage-bar">
      <span>{text}</span>
      <button type="button" className="primary" onClick={exportGame}>
        Exporter ma partie
      </button>
      {snap.readOnly && snap.loadErrorCode === "unsupportedVersion" && (
        <button type="button" className="secondary" onClick={() => void reloadForNewVersion()}>
          Mettre à jour le jeu
        </button>
      )}
      {message && <span>{message}</span>}
    </div>
  );
}

/** Écran « Sauvegarde illisible » : exporter le contenu brut d'abord, ne réinitialiser qu'après confirmation. */
export function LoadErrorScreen({ game, snap }: { game: GameLoop; snap: Snapshot }) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const code = snap.loadErrorCode;

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  async function exportRaw(): Promise<void> {
    try {
      const text = await game.exportRaw();
      if (text === null) {
        setMessage("Il n'y a rien à exporter : aucune sauvegarde n'est stockée.");
        return;
      }
      downloadBlob(new Blob([text], { type: "application/json" }), RAW_EXPORT_FILE_NAME);
      setMessage(`Le contenu est exporté tel quel dans le fichier ${RAW_EXPORT_FILE_NAME}.`);
    } catch (e) {
      setMessage(`Impossible de lire le stockage pour l'exporter (${e instanceof Error ? e.message : "erreur inconnue"}).`);
    }
  }

  if (code === "unsupportedVersion") {
    return (
      <main className="screen" aria-labelledby="load-error-title">
        <h1 id="load-error-title">Une version plus récente est nécessaire</h1>
        <p className="message" role="alert">
          {NEWER_VERSION_TEXT}
        </p>
        <p className="lead">Recharge le jeu pour récupérer la dernière version. Ta sauvegarde ne sera pas touchée.</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void reloadForNewVersion()}>
            Recharger et mettre à jour
          </button>
          <button type="button" className="secondary" onClick={() => void exportRaw()}>
            Exporter le contenu brut
          </button>
        </div>
        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </main>
    );
  }

  if (code === "storage") {
    return (
      <main className="screen" aria-labelledby="load-error-title">
        <h1 id="load-error-title">Le stockage ne répond pas</h1>
        <p className="message" role="alert">
          {snap.loadError}
        </p>
        <p className="lead">
          Ta sauvegarde n'a pas été touchée. Tu peux réessayer, ou jouer sans qu'elle soit enregistrée (rien ne sera écrit
          sur l'appareil).
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={() => location.reload()}>
            Réessayer
          </button>
          <button type="button" className="secondary" onClick={() => game.continueWithoutSave()}>
            Jouer sans enregistrer
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen" aria-labelledby="load-error-title">
      <h1 id="load-error-title">Sauvegarde illisible</h1>
      <p className="message" role="alert">
        {snap.loadError}
      </p>
      <p className="lead">
        Ta sauvegarde est toujours là, rien n'a été effacé. Commence par exporter son contenu tel quel : un fichier pourra
        peut-être être réparé ou relu plus tard.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void exportRaw()}>
          Exporter le contenu brut
        </button>
        <button type="button" className="secondary" onClick={() => setConfirming(true)} disabled={confirming}>
          Repartir d'un nouvel œuf…
        </button>
      </div>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {confirming && (
        <div
          className="panel"
          role="alertdialog"
          aria-labelledby="reset-confirm-title"
          aria-describedby="reset-confirm-text"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <h2 id="reset-confirm-title">Effacer la sauvegarde illisible ?</h2>
          <p id="reset-confirm-text">
            Elle sera supprimée de cet appareil, définitivement, et ta clairière repartira d'un nouvel œuf. Si tu n'as pas
            exporté le contenu brut, il sera perdu.
          </p>
          <div className="row">
            <button ref={keepRef} type="button" className="primary" onClick={() => setConfirming(false)}>
              Garder ma sauvegarde
            </button>
            <button type="button" className="secondary" onClick={() => void game.reset()}>
              Oui, tout effacer
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
