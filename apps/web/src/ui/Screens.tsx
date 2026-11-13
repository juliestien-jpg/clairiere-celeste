import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { defaultBalance } from "@tamagoshi/rules";
import type { AlbumEntry, Kind, SaveState, View } from "@tamagoshi/rules";
import { Creature, RESTING_VIEW } from "../creature/Creature";
import { hatchProgress } from "../creature/egg";
import { MAX_NAME_LENGTH } from "../loop/gameLoop";
import type { CreateResult, Notice } from "../loop/gameLoop";
import { ActionBar } from "./ActionBar";
import { FirstHints } from "./FirstHints";
import { PlayArea } from "./PlayArea";
import { ScreenHeader } from "./ScreenHeader";
import type { Nav } from "./ScreenHeader";
import { starPosition } from "./albumFormat";
import type { ActionHandler } from "./perform";
import { Vials } from "./Vials";
import { KIND_LABEL, describeEvent, primaryLabel, secondaryLabel } from "./labels";

// --- Création ----------------------------------------------------------------------------------

const CREATE_ERRORS: Record<Exclude<CreateResult, { ok: true }>["reason"], string> = {
  emptyName: "Donne un nom à ton compagnon pour que l'œuf puisse s'ouvrir.",
  tooLong: `Ce nom est un peu long : ${MAX_NAME_LENGTH} lettres au plus.`,
  exists: "Un compagnon vit déjà ici.",
};

export function CreateScreen({ onCreate, nav }: { onCreate: (name: string) => CreateResult; nav?: Nav | undefined }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent): void {
    e.preventDefault();
    const r = onCreate(name);
    setError(r.ok ? null : CREATE_ERRORS[r.reason]);
  }

  return (
    <main className="screen screen-create">
      <ScreenHeader title="Un œuf brille dans la clairière" nav={nav} />
      <Creature name="L'œuf" stage="egg" view={RESTING_VIEW} stateLabel="Un œuf opalescent attend, tout chaud" />
      <form className="panel" onSubmit={submit} noValidate>
        <label htmlFor="pet-name">Comment s'appellera ton compagnon ?</label>
        <input
          id="pet-name"
          name="name"
          type="text"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={error ? "pet-name-error" : undefined}
          aria-invalid={error !== null}
          placeholder="Lumi"
        />
        {error && (
          <p id="pet-name-error" className="message" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary">
          Faire éclore l'œuf
        </button>
      </form>
    </main>
  );
}

// --- Principal ---------------------------------------------------------------------------------

function NoticeLine({ notice, name, kind }: { notice: Notice | null; name: string; kind?: Kind }) {
  const [shownSeq, setShownSeq] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShownSeq(notice.seq);
    const t = setTimeout(() => setShownSeq(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const lines = notice && shownSeq === notice.seq ? notice.events.map((e) => describeEvent(e, name, kind)) : [];
  const first = lines.find((l) => l !== null && l.refused) ?? lines.find((l) => l !== null) ?? null;
  return (
    <p className="message" role="status" aria-live="polite" data-kind={first?.refused ? "refused" : "info"}>
      {first?.text ?? ""}
    </p>
  );
}

export function MainScreen(props: {
  state: SaveState;
  view: View;
  /** Heure virtuelle courante : sert à faire se fissurer l'œuf quand l'éclosion approche. */
  nowMs: number;
  notice: Notice | null;
  onAction: ActionHandler;
  nav?: Nav | undefined;
}) {
  const { state, view, nowMs, notice, onAction, nav } = props;
  const name = state.pet.name;
  return (
    <main className="screen screen-main">
      <ScreenHeader title={name} nav={nav} className="pet-name" />
      {state.pet.stage !== "egg" && <FirstHints />}
      <Vials state={state} levels={view.gaugeLevels} />
      <PlayArea name={name} kind={view.kind} asleep={state.pet.status.asleep} onAction={onAction}>
        <Creature
          name={name}
          stage={state.pet.stage}
          view={view}
          hatchProgress={state.pet.stage === "egg" ? hatchProgress(state.pet.bornAt, defaultBalance, nowMs) : 1}
          stateLabel={primaryLabel(view.primary, name)}
          secondaryLabel={secondaryLabel(view, name)}
        />
      </PlayArea>
      <NoticeLine notice={notice} name={name} kind={view.kind} />
      <ActionBar asleep={state.pet.status.asleep} onAction={onAction} />
    </main>
  );
}

// --- Après l'Envol -------------------------------------------------------------------------------

/** Choix de l'espèce du prochain œuf, réservé au débogage : « random » laisse les règles tirer (D6). */
type KindChoice = "random" | Kind;
const KIND_CHOICES: readonly { value: KindChoice; label: string }[] = [
  { value: "random", label: "Aléatoire" },
  { value: "kawaii", label: "Kawaii" },
  { value: "feerique", label: "Féérique" },
];

export function FlownScreen(props: {
  state: SaveState;
  /** `kind` absent : l'espèce est tirée au hasard par les règles. */
  onRebirth: (name: string, kind?: Kind) => void;
  notice: Notice | null;
  /** Jouer la séquence de l'Envol (vrai quand elle se produit sous les yeux du joueur). */
  playFlight?: boolean;
  /** Débogage : affiche le choix de l'espèce du prochain œuf. */
  debug?: boolean;
  nav?: Nav | undefined;
}) {
  const { state, onRebirth, notice, playFlight = false, debug = false, nav } = props;
  const name = state.pet.name;
  const [newName, setNewName] = useState(name);
  const [choice, setChoice] = useState<KindChoice>("random");
  const stars: Pick<AlbumEntry, "id" | "name" | "kind">[] = [
    ...state.album,
    { id: state.pet.id, name, kind: state.pet.kind },
  ];
  const flownView: View = { ...RESTING_VIEW, kind: state.pet.kind, primary: "flown" };

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (debug && choice !== "random") onRebirth(newName, choice);
    else onRebirth(newName);
  }

  return (
    <main className="screen screen-flown">
      <ScreenHeader title={`${name} rejoint les étoiles`} nav={nav} />
      <Creature
        name={name}
        stage={state.pet.stage}
        view={flownView}
        stateLabel={primaryLabel("flown", name)}
        caption={false}
        playFlight={playFlight}
      />
      <div className="sky" role="img" aria-label={`Le ciel de la clairière compte ${stars.length} étoile${stars.length > 1 ? "s" : ""}.`}>
        {stars.map((s, i) => (
          <span
            key={s.id}
            className={i === stars.length - 1 ? "star star-new" : "star"}
            data-kind={s.kind}
            style={starPosition(s.id, i)}
          />
        ))}
      </div>
      <p className="lead">Une étoile veille sur la clairière. Quand tu voudras, une lueur peut redescendre.</p>
      <NoticeLine notice={notice} name={name} kind={state.pet.kind} />
      <form className="panel" onSubmit={submit}>
        <label htmlFor="rebirth-name">Nom du nouvel œuf</label>
        <input
          id="rebirth-name"
          type="text"
          autoComplete="off"
          value={newName}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setNewName(e.target.value)}
        />
        {debug && (
          <fieldset className="kind-choice" data-testid="rebirth-kind">
            <legend>Espèce du nouvel œuf (débogage)</legend>
            {KIND_CHOICES.map((c) => (
              <label key={c.value}>
                <input
                  type="radio"
                  name="rebirth-kind"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" className="primary">
          Faire renaître
        </button>
      </form>
      {stars.length > 1 && (
        <p className="album">
          Étoiles de la clairière : {stars.map((s) => `${s.name} (${KIND_LABEL[s.kind]})`).join(", ")}.
        </p>
      )}
    </main>
  );
}
