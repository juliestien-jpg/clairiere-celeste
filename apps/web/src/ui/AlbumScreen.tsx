// Album : les créatures envolées, sous forme d'un ciel d'étoiles. Écran calme (verre dépoli, sans particules, D4).
import { useEffect, useRef, useState } from "react";
import type { AlbumEntry } from "@tamagoshi/rules";
import { Icon } from "./Icon";
import { STAGE_LABEL, formatDay, formatLifespan, lifespanOf, starPoints } from "./albumFormat";
import { KIND_LABEL } from "./labels";

export function AlbumScreen({ album, onClose }: { album: readonly AlbumEntry[]; onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const points = starPoints(album);
  const current = album.find((e) => e.id === selected) ?? null;
  const skyHeight = 300 + Math.max(0, album.length - 20) * 12;

  return (
    <main className="screen screen-panel" aria-labelledby="album-title">
      <header className="topbar">
        <span className="topbar-spacer" aria-hidden="true" />
        <h1 id="album-title" ref={headingRef} tabIndex={-1}>
          Album des étoiles
        </h1>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Fermer l'album">
          <Icon name="close" />
        </button>
      </header>

      {album.length === 0 ? (
        <section className="panel" aria-live="polite">
          <p className="panel-text">
            Le ciel est encore tout calme. Quand une créature s'envolera, elle deviendra une étoile et tu pourras la
            retrouver ici.
          </p>
        </section>
      ) : (
        <>
          <p className="lead">
            {album.length} étoile{album.length > 1 ? "s" : ""} dans le ciel. Touche une étoile pour lire sa fiche.
          </p>
          <div className="album-sky" style={{ height: `${skyHeight}px` }} role="group" aria-label="Ciel des étoiles">
            {album.map((e, i) => {
              const p = points[i];
              return (
                <button
                  key={e.id}
                  type="button"
                  className="album-star"
                  style={{ left: `${p?.left ?? 50}%`, top: `${p?.top ?? 50}%` }}
                  aria-pressed={selected === e.id}
                  aria-label={`${e.name}, ${KIND_LABEL[e.kind]}, envolé le ${formatDay(e.flownAt)}`}
                  onClick={() => setSelected(selected === e.id ? null : e.id)}
                >
                  <span className="star" data-kind={e.kind} aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <section className="panel" aria-live="polite" aria-label="Fiche de l'étoile">
            {current ? (
              <>
                <h2 className="card-title">{current.name}</h2>
                <dl className="card">
                  <dt>Espèce</dt>
                  <dd>{KIND_LABEL[current.kind]}</dd>
                  <dt>Né le</dt>
                  <dd>{formatDay(current.bornAt)}</dd>
                  <dt>Envolé le</dt>
                  <dd>{formatDay(current.flownAt)}</dd>
                  <dt>Stade atteint</dt>
                  <dd>{STAGE_LABEL[current.stage]}</dd>
                  <dt>A vécu</dt>
                  <dd>{formatLifespan(lifespanOf(current))}</dd>
                </dl>
                <button type="button" className="quiet" onClick={() => setSelected(null)}>
                  Fermer la fiche
                </button>
              </>
            ) : (
              <p className="panel-text">Choisis une étoile pour retrouver son histoire.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
