// Boucle de jeu : détient l'état, appelle `reduce` (jamais de règle ici) avec l'heure de l'horloge
// injectée, tient le journal des événements et déclenche la sauvegarde. Sans dépendance à React.
import { deriveView, reduce } from "@tamagoshi/rules";
import type { Action, Balance, GameEvent, Kind, SaveState, Settings, Time, View } from "@tamagoshi/rules";
import { createSave, InvalidIdentityError, LIMITS, MigrationError } from "@tamagoshi/rules";
import type { SaveStore } from "../storage/saveStore";
import type { ControllableClock } from "./clock";
import { localUtcOffsetMin } from "./clock";

export interface JournalEntry {
  seq: number;
  /** Heure virtuelle de l'événement. */
  atMs: number;
  event: GameEvent;
}

/** Événements du dernier appel à `reduce` qui méritent d'être dits au joueur. */
export interface Notice {
  seq: number;
  events: GameEvent[];
}

export interface Snapshot {
  ready: boolean;
  state: SaveState | null;
  time: Time;
  view: View | null;
  speed: number;
  paused: boolean;
  journal: readonly JournalEntry[];
  notice: Notice | null;
  loadError: string | null;
  /** Nature de l'erreur de chargement : `unsupportedVersion` (sauvegarde plus récente que le jeu), `invalid` (illisible), `storage` (stockage inaccessible). */
  loadErrorCode: LoadErrorCode | null;
  /** Vrai après une erreur de chargement : plus aucune écriture, pour ne jamais écraser la sauvegarde stockée. */
  readOnly: boolean;
  saveError: string | null;
  /** Augmente à chaque action du joueur, import, rechargement ou changement de réglage : les prévisions (D5) sont à refaire. */
  revision: number;
}

export type LoadErrorCode = "unsupportedVersion" | "invalid" | "storage";

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface Identity {
  id: string;
  seed: number;
}

export interface GameLoopOptions {
  clock: ControllableClock;
  balance: Balance;
  store: SaveStore;
  utcOffsetMin?: (ms: number) => number;
  tickIntervalMs?: number;
  /** Rythme de la boucle quand la page est cachée (suffisant pour les notifications « page ouverte »). */
  hiddenTickIntervalMs?: number;
  /** Sauvegarde périodique (sans prévenir les autres onglets) toutes les N secondes de boucle. */
  saveEveryTicks?: number;
  journalSize?: number;
  timers?: Timers;
  newIdentity?: () => Identity;
  /** Appelé après chaque `dispatch` (sons). Ne doit rien changer à l'état ; une erreur y est ignorée. */
  onDispatch?: (info: DispatchInfo) => void;
}

/** Ce que l'interface (sons…) apprend de chaque appel à `dispatch`. */
export interface DispatchInfo {
  action: Action;
  /** Événements conservés (un refus de tick est déjà retiré). */
  events: readonly GameEvent[];
  /** Tick qui a rattrapé un long laps de temps (réouverture, saut d'horloge) : à résumer, pas à rejouer. */
  catchUp: boolean;
  silentRefusal: boolean;
}

/** Écart au-delà duquel un tick est un rattrapage et non l'écoulement normal du temps. */
export const CATCH_UP_MS = 30_000;

export type CreateResult = { ok: true } | { ok: false; reason: "emptyName" | "tooLong" | "exists" };

/** Longueur maximale du nom (points de code, après trim) : la limite vient des règles. */
export const MAX_NAME_LENGTH = LIMITS.nameMaxLength;

function defaultIdentity(): Identity {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return { id: crypto.randomUUID(), seed: buf[0] ?? 1 };
}

const defaultTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** Événements purement internes : consignés au journal mais jamais annoncés au joueur. */
function isQuiet(e: GameEvent): boolean {
  return e.type === "needAppeared" || e.type === "needResolved";
}

export class GameLoop {
  private readonly clock: ControllableClock;
  private readonly balance: Balance;
  private readonly store: SaveStore;
  private readonly offsetOf: (ms: number) => number;
  private readonly tickIntervalMs: number;
  private readonly hiddenTickIntervalMs: number;
  private readonly saveEveryTicks: number;
  private readonly journalSize: number;
  private readonly timers: Timers;
  private readonly newIdentity: () => Identity;
  private readonly onDispatch: ((info: DispatchInfo) => void) | undefined;

  private state: SaveState | null = null;
  private ready = false;
  private journal: JournalEntry[] = [];
  private seq = 0;
  private revision = 0;
  private notice: Notice | null = null;
  private loadError: string | null = null;
  private loadErrorCode: LoadErrorCode | null = null;
  private readOnly = false;
  private hidden = false;
  /** Prochaine écriture sans comparaison : la chronologie vient d'être translatée (horloge reculée), `savedAt` recule légitimement. */
  private forceNextSave = false;
  private saveError: string | null = null;
  private ticksSinceSave = 0;
  private timer: unknown = null;
  private unsubscribeStore: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;

  constructor(opts: GameLoopOptions) {
    this.clock = opts.clock;
    this.balance = opts.balance;
    this.store = opts.store;
    this.offsetOf = opts.utcOffsetMin ?? localUtcOffsetMin;
    this.tickIntervalMs = opts.tickIntervalMs ?? 1000;
    this.hiddenTickIntervalMs = opts.hiddenTickIntervalMs ?? 15_000;
    this.saveEveryTicks = opts.saveEveryTicks ?? 10;
    this.journalSize = opts.journalSize ?? 60;
    this.timers = opts.timers ?? defaultTimers;
    this.newIdentity = opts.newIdentity ?? defaultIdentity;
    this.onDispatch = opts.onDispatch;
    this.snapshot = this.compute();
  }

  // --- Observation (useSyncExternalStore) ---------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): Snapshot => this.snapshot;

  get currentBalance(): Balance {
    return this.balance;
  }

  /** Heure passée aux règles : toujours (heure virtuelle, décalage local à cet instant). */
  time(): Time {
    const nowMs = this.clock.now();
    return { nowMs, utcOffsetMin: this.offsetOf(nowMs) };
  }

  private compute(): Snapshot {
    const time = this.time();
    return {
      ready: this.ready,
      state: this.state,
      time,
      view: this.state ? deriveView(this.state, time, this.balance) : null,
      speed: this.clock.speed,
      paused: this.clock.paused,
      journal: this.journal,
      notice: this.notice,
      loadError: this.loadError,
      loadErrorCode: this.loadErrorCode,
      readOnly: this.readOnly,
      saveError: this.saveError,
      revision: this.revision,
    };
  }

  /** Recalcule l'instantané et prévient les observateurs. */
  emit(): void {
    this.snapshot = this.compute();
    this.listeners.forEach((l) => l());
  }

  // --- Cycle de vie -------------------------------------------------------------------------

  /** Charge la sauvegarde (migrée) et rattrape le temps d'absence. Idempotent. */
  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      this.state = await this.store.load();
    } catch (e) {
      this.failLoad(e);
    }
    this.ready = true;
    if (this.state) this.dispatch({ type: "tick" });
    else this.emit();
  }

  /** Erreur de chargement : on passe en lecture seule, la sauvegarde stockée ne sera plus jamais écrite. */
  private failLoad(e: unknown): void {
    this.readOnly = true;
    this.loadError = e instanceof Error ? e.message : "sauvegarde illisible";
    this.loadErrorCode = e instanceof MigrationError ? (e.code === "unsupportedVersion" ? "unsupportedVersion" : "invalid") : "storage";
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.timers.setInterval(() => this.tick(), this.currentTickMs());
    this.unsubscribeStore ??= this.store.subscribe(() => void this.reloadFromStore());
  }

  private currentTickMs(): number {
    return this.hidden ? this.hiddenTickIntervalMs : this.tickIntervalMs;
  }

  /**
   * Page cachée : la boucle ralentit (plus de rendu chaque seconde) mais continue, pour que les
   * notifications « page ouverte » (D5) apparaissent à l'heure. Revenir à l'écran refait un tick.
   */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = this.timers.setInterval(() => this.tick(), this.currentTickMs());
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  // --- Actions ------------------------------------------------------------------------------

  /** Fait passer le temps ; sauvegarde périodiquement. */
  tick(): void {
    if (!this.state) return;
    this.dispatch({ type: "tick" });
    if (++this.ticksSinceSave >= this.saveEveryTicks) void this.persist(false);
  }

  /**
   * Applique une action via `reduce`. Les `actionRefused` d'un `tick` (après l'Envol) sont ignorés.
   * Renvoie les événements conservés. `silentRefusal` : un refus n'apparaît pas dans la notice affichée.
   */
  dispatch(action: Action, options: { silentRefusal?: boolean } = {}): GameEvent[] {
    if (!this.state) return [];
    const time = this.time();
    const catchUp = action.type === "tick" && time.nowMs - this.state.pet.lastUpdatedAt > CATCH_UP_MS;
    const result = reduce(this.state, action, time, this.balance);
    this.state = result.state;
    if (result.events.some((e) => e.type === "clockAdjusted")) this.forceNextSave = true;
    const events =
      action.type === "tick"
        ? result.events.filter((e) => !(e.type === "actionRefused" && e.action === "tick"))
        : result.events;
    for (const event of events) {
      this.journal = [{ seq: ++this.seq, atMs: time.nowMs, event }, ...this.journal].slice(0, this.journalSize);
    }
    // `silentRefusal` : le refus reste dans le journal mais n'est pas annoncé (caresse refusée pour temps de recharge).
    const shown = events.filter((e) => !isQuiet(e) && !(options.silentRefusal && e.type === "actionRefused"));
    if (shown.length > 0) this.notice = { seq: ++this.seq, events: shown };
    if (action.type !== "tick") this.revision++;
    this.emit();
    if (action.type !== "tick") void this.persist(true);
    try {
      this.onDispatch?.({ action, events, catchUp, silentRefusal: options.silentRefusal === true });
    } catch {
      // Un son raté ne doit jamais gêner le jeu.
    }
    return events;
  }

  /** Crée l'animal (écran de création). */
  create(rawName: string): CreateResult {
    if (this.state) return { ok: false, reason: "exists" };
    const name = rawName.trim();
    if (name === "") return { ok: false, reason: "emptyName" };
    if ([...name].length > MAX_NAME_LENGTH) return { ok: false, reason: "tooLong" };
    const { id, seed } = this.newIdentity();
    try {
      this.state = createSave({ id, name, seed }, this.time(), this.balance);
    } catch (e) {
      if (e instanceof InvalidIdentityError) return { ok: false, reason: "tooLong" };
      throw e;
    }
    this.revision++;
    this.journal = [];
    this.notice = null;
    this.emit();
    void this.persist(true);
    void this.store.requestPersistence();
    return { ok: true };
  }

  /**
   * Après l'Envol : nouvel œuf (action `rebirth`). L'espèce est tirée par les règles (D6) ; `kind` ne sert
   * qu'au débogage, pour la forcer.
   */
  rebirth(rawName: string, kind?: Kind): GameEvent[] {
    const { id, seed } = this.newIdentity();
    return this.dispatch({ type: "rebirth", id, name: rawName.trim(), seed, ...(kind ? { kind } : {}) });
  }

  // --- Outils de débogage et de sauvegarde ---------------------------------------------------

  setSpeed(factor: number): void {
    this.clock.setSpeed(factor);
    this.emit();
  }

  setPaused(paused: boolean): void {
    if (paused) this.clock.pause();
    else this.clock.resume();
    this.emit();
  }

  /** Saute dans le temps, puis rattrape tout de suite. */
  jump(ms: number): void {
    this.clock.jump(ms);
    if (this.state) this.dispatch({ type: "tick" });
    else this.emit();
  }

  /**
   * Efface la sauvegarde : retour à l'écran de création. Refusé (sans rien effacer) quand la sauvegarde vient
   * d'une version plus récente du jeu. Renvoie `false` si rien n'a été effacé.
   */
  async reset(): Promise<boolean> {
    if (this.loadErrorCode === "unsupportedVersion") return false;
    this.readOnly = false;
    this.loadErrorCode = null;
    this.state = null;
    this.revision++;
    this.journal = [];
    this.notice = null;
    this.loadError = null;
    this.emit();
    await this.store.clear();
    return true;
  }

  /** Après une erreur de stockage (et seulement alors) : joue sans sauvegarde plutôt que de rester bloqué. */
  continueWithoutSave(): void {
    if (this.loadErrorCode !== "storage") return;
    this.loadError = null;
    this.loadErrorCode = null;
    this.emit();
  }

  exportBlob(): Blob | null {
    return this.state ? this.store.exportFile(this.state) : null;
  }

  /** Contenu stocké tel quel (sauvegarde illisible comprise), à télécharger sans transformation. */
  exportRaw(): Promise<string | null> {
    return this.store.readRaw();
  }

  /** Lit et valide un fichier de sauvegarde sans rien changer. Lève `MigrationError` si illisible. */
  parseImport(file: Blob): Promise<SaveState> {
    return this.store.importFile(file);
  }

  /** Remplace l'état par une sauvegarde déjà lue (après confirmation du joueur). */
  async applyImport(imported: SaveState): Promise<void> {
    this.state = imported;
    this.loadError = null;
    this.loadErrorCode = null;
    this.readOnly = false;
    this.forceNextSave = true; // le fichier choisi par le joueur remplace le stockage, même plus ancien
    this.journal = [];
    this.notice = null;
    this.revision++;
    this.emit();
    await this.persist(true);
    this.dispatch({ type: "tick" });
  }

  /** Remplace l'état par celui d'un fichier. Lève `MigrationError` si le fichier est illisible. */
  async importFile(file: Blob): Promise<void> {
    await this.applyImport(await this.parseImport(file));
  }

  /**
   * Modifie les réglages (`settings` de la sauvegarde). `packages/rules` n'a pas d'action pour cela : le
   * réglage est écrit ici, sans passer par `reduce`, et suit la sauvegarde (export, import, autres onglets).
   */
  updateSettings(patch: Partial<Settings>): void {
    if (!this.state) return;
    const savedAt = Math.max(this.state.savedAt, this.time().nowMs);
    this.state = { ...this.state, savedAt, settings: { ...this.state.settings, ...patch } };
    this.revision++;
    this.emit();
    void this.persist(true);
  }

  /** Écrit l'état maintenant (page cachée ou fermée). */
  flush(): Promise<void> {
    return this.persist(false);
  }

  private async persist(notify: boolean): Promise<void> {
    if (!this.state || this.readOnly) return;
    this.ticksSinceSave = 0;
    const force = this.forceNextSave;
    this.forceNextSave = false;
    try {
      const outcome = await this.store.save(this.state, { notify, force });
      if (outcome.status === "newer") {
        // Un autre onglet a écrit plus récemment : on garde son état (dernier écrit gagne) et on rattrape le temps.
        this.state = outcome.state;
        this.revision++;
        this.dispatch({ type: "tick" });
      }
      if (this.saveError !== null) {
        this.saveError = null;
        this.emit();
      }
    } catch (e) {
      if (force) this.forceNextSave = true;
      if (e instanceof MigrationError) {
        // Le stockage contient une sauvegarde qu'on ne sait pas lire (autre onglet plus récent...) : ne plus rien écrire.
        this.failLoad(e);
        this.emit();
        return;
      }
      this.saveError = e instanceof Error ? e.message : "écriture impossible";
      this.emit();
    }
  }

  /** Un autre onglet a écrit : dernier écrit gagne, on recharge puis on rattrape le temps. */
  private async reloadFromStore(): Promise<void> {
    try {
      this.state = await this.store.load();
      this.loadError = null;
      this.loadErrorCode = null;
      this.readOnly = false;
    } catch (e) {
      this.failLoad(e);
    }
    this.revision++;
    if (this.state) this.dispatch({ type: "tick" });
    else this.emit();
  }
}
