// Horloge virtuelle injectée : heure virtuelle = heure réelle + décalage, avec un facteur de vitesse.
// Les règles ne lisent jamais d'horloge : cette classe fournit seulement l'entrée `nowMs`.

export interface GameClock {
  /** Heure virtuelle courante, en millisecondes UTC entières. */
  now(): number;
  readonly speed: number;
  readonly paused: boolean;
}

/** Horloge pilotable (panneau de débogage). */
export interface ControllableClock extends GameClock {
  setSpeed(factor: number): void;
  pause(): void;
  resume(): void;
  jump(ms: number): void;
}

export class VirtualClock implements ControllableClock {
  private anchorReal: number;
  private anchorVirtual: number;
  private _speed = 1;
  private _paused = false;
  private readonly realNow: () => number;

  constructor(realNow: () => number = () => Date.now(), initialOffsetMs = 0) {
    this.realNow = realNow;
    this.anchorReal = realNow();
    this.anchorVirtual = this.anchorReal + initialOffsetMs;
  }

  get speed(): number {
    return this._speed;
  }
  get paused(): boolean {
    return this._paused;
  }
  /** Décalage actuel entre l'heure virtuelle et l'heure réelle (ms). */
  get offsetMs(): number {
    return this.now() - this.realNow();
  }

  now(): number {
    if (this._paused) return Math.floor(this.anchorVirtual);
    return Math.floor(this.anchorVirtual + (this.realNow() - this.anchorReal) * this._speed);
  }

  /** Repart de l'instant virtuel courant, pour que les changements de vitesse ne rétroagissent pas. */
  private rebase(): void {
    this.anchorVirtual = this.now();
    this.anchorReal = this.realNow();
  }

  setSpeed(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("facteur de vitesse invalide");
    this.rebase();
    this._speed = factor;
  }

  pause(): void {
    if (this._paused) return;
    this.rebase();
    this._paused = true;
  }

  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    this.anchorReal = this.realNow();
  }

  /** Saute dans le temps (positif : vers l'avenir). Fonctionne aussi en pause. */
  jump(ms: number): void {
    this.rebase();
    this.anchorVirtual += ms;
  }
}

/** Décalage local par rapport à UTC, en minutes, à l'instant donné (gère l'heure d'été). */
export function localUtcOffsetMin(ms: number): number {
  return -new Date(ms).getTimezoneOffset();
}
