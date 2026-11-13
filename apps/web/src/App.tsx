import { useEffect, useState, useSyncExternalStore } from "react";
import { MotionContext } from "./motion/MotionContext";
import { ParticleLayer } from "./particles/ParticleLayer";
import { game, storagePersistent } from "./runtime";
import { Sky } from "./theme/Sky";
import { perform } from "./ui/perform";
import { DebugPanel, isDebugVisible } from "./ui/DebugPanel";
import { CreateScreen, FlownScreen, MainScreen } from "./ui/Screens";
import { pageTitle } from "./ui/labels";

const debug = isDebugVisible();

/** `prefers-reduced-motion` et réglage de la sauvegarde : attribut lu par la feuille de style, et booléen. */
function useMotionPreference(setting: "system" | "on" | "off" | undefined): boolean {
  const [systemReduces, setSystemReduces] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setSystemReduces(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const reduce = setting === "on" || (setting !== "off" && systemReduces);
  useEffect(() => {
    document.documentElement.dataset["motion"] = reduce ? "reduce" : "full";
  }, [reduce]);
  return reduce;
}

export function App() {
  const snap = useSyncExternalStore(game.subscribe, game.getSnapshot);
  const { state, view } = snap;

  useEffect(() => {
    let cancelled = false;
    void game.init().then(() => {
      if (!cancelled) game.start();
    });
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") game.tick();
      else void game.flush();
    };
    const onHide = (): void => void game.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      game.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const reduced = useMotionPreference(state?.settings.reducedMotion);

  // L'Envol n'est joué que s'il se produit sous nos yeux (pas à la réouverture d'une sauvegarde déjà envolée).
  const life = state?.pet.life ?? null;
  const [prevLife, setPrevLife] = useState(life);
  const [animateFlight, setAnimateFlight] = useState(false);
  if (prevLife !== life) {
    setPrevLife(life);
    setAnimateFlight(prevLife === "alive" && life === "flown");
  }

  const title = pageTitle(state?.pet.name ?? null, view);
  useEffect(() => {
    document.title = title;
  }, [title]);

  let body;
  if (!snap.ready) {
    body = <p className="lead" role="status">La clairière se réveille…</p>;
  } else if (snap.loadError && !state) {
    body = (
      <main className="screen">
        <h1>Sauvegarde illisible</h1>
        <p className="message" role="alert">{snap.loadError}</p>
        <p className="lead">Tu peux importer un fichier de sauvegarde ou repartir d'un nouvel œuf (panneau de débogage).</p>
        <button type="button" className="primary" onClick={() => void game.reset()}>
          Repartir d'un nouvel œuf
        </button>
      </main>
    );
  } else if (!state || !view) {
    body = <CreateScreen onCreate={(name) => game.create(name)} />;
  } else if (state.pet.life === "flown") {
    body = (
      <FlownScreen
        state={state}
        notice={snap.notice}
        onRebirth={(name, kind) => game.rebirth(name, kind)}
        playFlight={animateFlight}
        debug={debug}
      />
    );
  } else {
    body = <MainScreen state={state} view={view} notice={snap.notice} onAction={perform} />;
  }

  return (
    <MotionContext.Provider value={reduced}>
      <Sky nowMs={snap.time.nowMs} utcOffsetMin={snap.time.utcOffsetMin} />
      <ParticleLayer />
      <div className="app" data-flown={state?.pet.life === "flown" ? "true" : "false"}>
        <div className="game">
          {body}
          {!storagePersistent && (
            <p className="message" role="status">
              Le stockage du navigateur n'est pas disponible : ta progression ne sera pas gardée.
            </p>
          )}
        </div>
        {debug && <DebugPanel game={game} snap={snap} />}
      </div>
    </MotionContext.Provider>
  );
}
