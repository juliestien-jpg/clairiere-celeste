// En-tête d'un écran : titre au centre, accès à l'album (à gauche) et aux réglages (à droite).
// Boutons ronds de 48 px, icône + nom accessible ; le titre reste centré même quand un bouton manque.
import { Icon } from "./Icon";

export interface Nav {
  /** Absent tant qu'il n'y a pas d'animal. */
  onAlbum?: () => void;
  onSettings: () => void;
}

export function ScreenHeader({ title, nav, className }: { title: string; nav?: Nav | undefined; className?: string | undefined }) {
  return (
    <header className="topbar">
      {nav?.onAlbum ? (
        <button type="button" className="iconbtn" data-nav="album" onClick={nav.onAlbum} aria-label="Album des étoiles">
          <Icon name="star" />
        </button>
      ) : (
        <span className="topbar-spacer" aria-hidden="true" />
      )}
      <h1 className={className}>{title}</h1>
      {nav ? (
        <button type="button" className="iconbtn" data-nav="settings" onClick={nav.onSettings} aria-label="Réglages">
          <Icon name="gear" />
        </button>
      ) : (
        <span className="topbar-spacer" aria-hidden="true" />
      )}
    </header>
  );
}
