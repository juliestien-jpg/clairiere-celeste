// Réglages : mouvement, son, notifications, sauvegarde (export / import) et « À propos ».
// Écran calme (verre dépoli, sans particules, D4). Les réglages vivent dans `settings` de la sauvegarde.
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { SaveState, Settings } from "@tamagoshi/rules";
import type { GameLoop } from "../loop/gameLoop";
import { permissionState, requestNotificationPermission } from "../notify/system";
import type { PermissionState } from "../notify/notifier";
import { exportFileName } from "../storage/saveStore";
import { Icon } from "./Icon";
import { STAGE_LABEL } from "./albumFormat";
import { KIND_LABEL } from "./labels";

const MOTION_CHOICES: readonly { value: Settings["reducedMotion"]; label: string; help: string }[] = [
  { value: "system", label: "Comme mon appareil", help: "Suit le réglage de ton téléphone ou de ton ordinateur." },
  { value: "on", label: "Mouvement réduit", help: "Étoiles fixes, pas de particules, simples fondus." },
  { value: "off", label: "Tous les mouvements", help: "Respiration, lueurs et étincelles." },
];

function Switch(props: { id: string; label: string; checked: boolean; onChange: (next: boolean) => void; describedBy?: string }) {
  const { id, label, checked, onChange, describedBy } = props;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-label">{label}</span>
      {/* L'état est aussi écrit en toutes lettres : jamais la couleur ou la position seules. */}
      <span className="switch-state">{checked ? "Activé" : "Désactivé"}</span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

export function SettingsScreen(props: {
  game: GameLoop;
  state: SaveState | null;
  onClose: () => void;
  onResetHints: () => void;
}) {
  const { game, state, onClose, onResetHints } = props;
  const settings = state?.settings ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [permission, setPermission] = useState<PermissionState>(() => permissionState());
  const [notifMessage, setNotifMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [hintsMessage, setHintsMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<SaveState | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  // Échap : ferme d'abord la confirmation d'import, puis l'écran (géré par l'application).
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && pending) {
      e.stopPropagation();
      setPending(null);
    }
  }

  async function toggleNotifications(next: boolean): Promise<void> {
    setNotifMessage(null);
    if (!next) {
      game.updateSettings({ notifications: false });
      return;
    }
    // La permission n'est demandée que maintenant, parce que le joueur vient d'activer l'option.
    let p = permissionState();
    if (p === "default") p = await requestNotificationPermission();
    setPermission(p);
    if (p === "granted") {
      game.updateSettings({ notifications: true });
    } else if (p === "denied") {
      game.updateSettings({ notifications: false });
      setNotifMessage("Les notifications sont bloquées dans ton navigateur. Tu peux les autoriser dans ses réglages, puis réessayer.");
    } else if (p === "unsupported") {
      setNotifMessage("Ce navigateur ne propose pas les notifications ici.");
    } else {
      game.updateSettings({ notifications: false });
      setNotifMessage("Pas de souci : tu pourras les activer plus tard.");
    }
  }

  function download(): void {
    const blob = game.exportBlob();
    if (!blob || !state) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(state);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaveMessage(`Sauvegarde exportée dans le fichier ${exportFileName(state)}.`);
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaveMessage(null);
    try {
      setPending(await game.parseImport(file));
    } catch (err) {
      setSaveMessage(`Ce fichier n'est pas une sauvegarde lisible (${err instanceof Error ? err.message : "erreur inconnue"}). Rien n'a été changé.`);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!pending) return;
    await game.applyImport(pending);
    setSaveMessage(`${pending.pet.name} est arrivé dans la clairière.`);
    setPending(null);
  }

  const notifOn = settings?.notifications === true;
  const notifBlocked = permission === "denied" || permission === "unsupported";

  return (
    <main className="screen screen-panel" aria-labelledby="settings-title" onKeyDown={onKeyDown}>
      <header className="topbar">
        <span className="topbar-spacer" aria-hidden="true" />
        <h1 id="settings-title" ref={headingRef} tabIndex={-1}>
          Réglages
        </h1>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Fermer les réglages">
          <Icon name="close" />
        </button>
      </header>

      {settings && (
        <>
          <fieldset className="panel setting">
            <legend>Mouvement</legend>
            {MOTION_CHOICES.map((c) => (
              <label key={c.value} className="choice">
                <input
                  type="radio"
                  name="reduced-motion"
                  value={c.value}
                  checked={settings.reducedMotion === c.value}
                  onChange={() => game.updateSettings({ reducedMotion: c.value })}
                />
                <span>
                  <span className="choice-label">{c.label}</span>
                  <span className="choice-help">{c.help}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <section className="panel setting" aria-labelledby="sound-title">
            <h2 id="sound-title">Son</h2>
            <Switch
              id="sound-switch"
              label="Sons"
              checked={settings.sound}
              onChange={(sound) => game.updateSettings({ sound })}
              describedBy="sound-help"
            />
            <p id="sound-help" className="panel-text">
              Les sons arriveront bientôt : ton choix est déjà gardé.
            </p>
          </section>

          <section className="panel setting" aria-labelledby="notif-title">
            <h2 id="notif-title">Notifications</h2>
            <Switch
              id="notif-switch"
              label="Me prévenir quand il a besoin de moi"
              checked={notifOn}
              onChange={(v) => void toggleNotifications(v)}
              describedBy="notif-help"
            />
            <p id="notif-help" className="panel-text">
              Elles ne marchent que tant que le jeu est ouvert (dans un onglet ou l'app installée).
            </p>
            {notifOn && notifBlocked && (
              <p className="message" role="status">
                Le navigateur ne laisse plus afficher de notifications : autorise-les dans ses réglages.
              </p>
            )}
            {notifMessage && (
              <p className="message" role="status">
                {notifMessage}
              </p>
            )}
          </section>
        </>
      )}

      <section className="panel setting" aria-labelledby="save-title">
        <h2 id="save-title">Sauvegarde</h2>
        <p className="panel-text">
          Ton compagnon vit sur cet appareil, sans compte. Exporte un fichier pour le garder en lieu sûr ou le retrouver
          ailleurs.
        </p>
        <div className="row">
          <button type="button" className="secondary" onClick={download} disabled={!state}>
            Exporter ma sauvegarde
          </button>
          <label className="secondary file-button">
            Importer une sauvegarde
            <input type="file" accept=".json,application/json" onChange={(e) => void onPickFile(e)} />
          </label>
        </div>

        {pending && (
          <div className="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
            <h3 id="confirm-title">Remplacer {state ? state.pet.name : "ta clairière"} ?</h3>
            <p id="confirm-text">
              {state
                ? `Ce fichier contient ${pending.pet.name} (${STAGE_LABEL[pending.pet.stage]}, ${KIND_LABEL[pending.pet.kind]}, ${pending.album.length} étoile${pending.album.length > 1 ? "s" : ""} dans l'album). S'il est importé, ${state.pet.name} et son album seront remplacés et ne pourront pas être retrouvés, sauf si tu les as exportés.`
                : `Ce fichier contient ${pending.pet.name} (${STAGE_LABEL[pending.pet.stage]}, ${KIND_LABEL[pending.pet.kind]}). Il arrivera dans la clairière.`}
            </p>
            <div className="row">
              <button ref={cancelRef} type="button" className="primary" onClick={() => setPending(null)}>
                {state ? `Garder ${state.pet.name}` : "Annuler"}
              </button>
              {state && (
                <button type="button" className="secondary" onClick={download}>
                  Exporter d'abord
                </button>
              )}
              <button type="button" className="secondary" onClick={() => void confirmImport()}>
                {state ? "Remplacer par ce fichier" : "Importer"}
              </button>
            </div>
          </div>
        )}
        {saveMessage && (
          <p className="message" role="status">
            {saveMessage}
          </p>
        )}
      </section>

      <section className="panel setting" aria-labelledby="help-title">
        <h2 id="help-title">Aide</h2>
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onResetHints();
              setHintsMessage("Les bulles d'aide reviendront sur l'écran principal.");
            }}
          >
            Revoir les bulles d'aide
          </button>
        </div>
        {hintsMessage && (
          <p className="message" role="status">
            {hintsMessage}
          </p>
        )}
      </section>

      <section className="panel setting" aria-labelledby="about-title">
        <h2 id="about-title">À propos</h2>
        <p className="panel-text">Clairière céleste : un petit compagnon de lumière à faire vivre. Rien ne quitte ton appareil.</p>
      </section>
    </main>
  );
}
