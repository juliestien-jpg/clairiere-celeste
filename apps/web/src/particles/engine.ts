// Moteur de particules (D4) : un seul canvas 2D en surimpression, préréglages de spec/motion/particles.json.
// Au plus `maxParticles` à l'écran ; rien ne passe devant les yeux (zone « face ») ; pause quand l'onglet est
// caché ; aucune particule en mouvement réduit. Les lueurs sont des dégradés radiaux, jamais des flous.
import type { Anchor, BurstRequest } from "../creature/effects";
import type { EmitterSpec, ParticleShape, ParticlesSpec, PresetSpec, Range, Vec2 } from "../creature/types";
import { hexToRgb } from "../theme/theme";

// --- Fonctions pures ------------------------------------------------------------------------------

export type Rng = () => number;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const rand = (rng: Rng, r: Range): number => lerp(r[0], r[1], rng());
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Opacité due au fondu d'entrée et de sortie (fractions de la vie). */
export function fadeAlpha(u: number, fade: { in: number; out: number }): number {
  let a = 1;
  if (fade.in > 0 && u < fade.in) a = Math.min(a, u / fade.in);
  if (fade.out > 0 && u > 1 - fade.out) a = Math.min(a, (1 - u) / fade.out);
  return Math.max(0, Math.min(1, a));
}

export function pointInEmitter(e: EmitterSpec, rng: Rng): Vec2 {
  switch (e.shape) {
    case "point":
      return e.center;
    case "line": {
      const t = rng();
      return [lerp(e.from[0], e.to[0], t), lerp(e.from[1], e.to[1], t)];
    }
    case "ellipse": {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng());
      return [e.center[0] + Math.cos(a) * e.radii[0] * r, e.center[1] + Math.sin(a) * e.radii[1] * r];
    }
  }
}

/** Vrai si le point est dans l'ellipse (centre, rayons). */
export function insideEllipse(p: Vec2, center: Vec2, radii: Vec2): boolean {
  const dx = (p[0] - center[0]) / radii[0];
  const dy = (p[1] - center[1]) / radii[1];
  return dx * dx + dy * dy < 1;
}

// --- Particules ----------------------------------------------------------------------------------

interface Particle {
  preset: string;
  spec: PresetSpec;
  /** Position de départ, en unités du repère 240. */
  x0: number;
  y0: number;
  /** Position courante (unités). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  rot: number;
  spin: number;
  phase: number;
  wanderPeriod: number;
  theta0: number;
  /** 0 dans la zone du visage, 1 ailleurs : lissé pour un fondu. */
  faceAlpha: number;
  /** Position affichée et opacité finale, mises à jour à chaque image. */
  dx: number;
  dy: number;
  alpha: number;
  scale: number;
}

interface Pending {
  at: number;
  preset: string;
}

export interface EngineOptions {
  spec: ParticlesSpec;
  colors: Record<string, string>;
  rng?: Rng;
}

export class ParticleEngine {
  private readonly spec: ParticlesSpec;
  private readonly colors: Record<string, string>;
  private readonly rng: Rng;
  private readonly face: { center: Vec2; radii: Vec2 } | null;
  private alive: Particle[] = [];
  private pending: Pending[] = [];
  private continuous = new Map<string, { nextAt: number }>();
  private simTime = 0;
  private lastFrame: number | null = null;
  private raf: number | null = null;
  private paused = false;
  private reduced = false;
  private anchor: (() => Anchor | null) | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private dpr = 1;

  constructor(opts: EngineOptions) {
    this.spec = opts.spec;
    this.colors = opts.colors;
    this.rng = opts.rng ?? Math.random;
    const z = opts.spec.avoidZones.find((a) => a.id === "face");
    this.face = z ? { center: z.center, radii: z.radii } : null;
  }

  // --- Branchement ---

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
  }

  detach(): void {
    this.stopLoop();
    this.alive = [];
    this.pending = [];
    this.canvas = null;
    this.ctx = null;
  }

  resize(): void {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  setAnchor(fn: (() => Anchor | null) | null): void {
    this.anchor = fn;
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.alive = [];
      this.pending = [];
      this.clear();
      this.stopLoop();
    } else {
      this.ensureLoop();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopLoop();
    else this.ensureLoop();
  }

  // --- Émission ---

  /** Préréglages continus actifs (lucioles, petites lunes) ; les autres s'arrêtent (leurs particules finissent). */
  setContinuous(ids: readonly string[]): void {
    for (const id of [...this.continuous.keys()]) if (!ids.includes(id)) this.continuous.delete(id);
    for (const id of ids) {
      const p = this.spec.presets[id];
      if (p && p.mode === "continuous" && !this.continuous.has(id)) this.continuous.set(id, { nextAt: this.simTime });
    }
    this.ensureLoop();
  }

  burst(req: BurstRequest): void {
    if (this.reduced) return;
    const p = this.spec.presets[req.preset];
    if (!p) return;
    const count = req.count ?? p.count ?? p.maxAlive ?? 6;
    const dur = req.emitDuration ?? p.emitDuration ?? 600;
    for (let i = 0; i < count; i++) {
      this.pending.push({ at: this.simTime + (count > 1 ? (dur * i) / (count - 1) : 0), preset: req.preset });
    }
    this.ensureLoop();
  }

  get count(): number {
    return this.alive.length;
  }

  /** Crée une particule si le plafond le permet : sinon cède la place à plus basse priorité, ou abandonne. */
  private spawn(id: string): boolean {
    const spec = this.spec.presets[id];
    if (!spec) return false;
    if (this.alive.length >= this.spec.limits.maxParticles) {
      let victim = -1;
      for (let i = 0; i < this.alive.length; i++) {
        const v = this.alive[i] as Particle;
        if (v.spec.priority >= spec.priority) continue;
        const cur = victim >= 0 ? (this.alive[victim] as Particle) : null;
        if (!cur || v.spec.priority < cur.spec.priority || (v.spec.priority === cur.spec.priority && v.age > cur.age)) victim = i;
      }
      if (victim < 0) return false;
      this.alive.splice(victim, 1);
    }
    const rng = this.rng;
    const [x0, y0] = pointInEmitter(spec.emitter, rng);
    const angle = (rand(rng, spec.angle) * Math.PI) / 180;
    const speed = rand(rng, spec.speed);
    const colorId = spec.colors[Math.floor(rng() * spec.colors.length)] ?? "firefly-gold";
    this.alive.push({
      preset: id,
      spec,
      x0,
      y0,
      x: x0,
      y: y0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: rand(rng, spec.life),
      size: rand(rng, spec.size),
      color: this.colors[colorId] ?? "#FFD27A",
      rot: rng() * Math.PI * 2,
      spin: spec.spin ? (rand(rng, spec.spin) * Math.PI) / 180 : 0,
      phase: rng() * Math.PI * 2,
      wanderPeriod: spec.wander ? rand(rng, spec.wander.period) : 1,
      theta0: Math.PI / 2 + (rng() - 0.5) * 0.6,
      faceAlpha: 1,
      dx: x0,
      dy: y0,
      alpha: 0,
      scale: 1,
    });
    return true;
  }

  // --- Simulation ---

  /** Avance la simulation de `dtMs` (exposé pour les tests). */
  step(dtMs: number): void {
    this.simTime += dtMs;
    const dt = dtMs / 1000;

    // Naissances : bouffées en attente, puis préréglages continus.
    if (this.pending.length > 0) {
      const due = this.pending.filter((p) => p.at <= this.simTime);
      this.pending = this.pending.filter((p) => p.at > this.simTime);
      for (const p of due) this.spawn(p.preset);
    }
    for (const [id, c] of this.continuous) {
      const spec = this.spec.presets[id];
      if (!spec || this.simTime < c.nextAt) continue;
      const living = this.alive.reduce((n, p) => (p.preset === id ? n + 1 : n), 0);
      if (living < (spec.maxAlive ?? 4)) this.spawn(id);
      c.nextAt = this.simTime + rand(this.rng, spec.spawnEveryMs ?? [1500, 2500]);
    }

    for (const p of this.alive) this.advance(p, dtMs, dt);
    this.alive = this.alive.filter((p) => p.age < p.life);
  }

  private advance(p: Particle, dtMs: number, dt: number): void {
    const s = p.spec;
    p.age += dtMs;
    const u = Math.min(1, p.age / p.life);
    p.rot += p.spin * dt;
    const wobble = s.wander ? Math.sin(p.phase + (p.age / p.wanderPeriod) * Math.PI * 2) * s.wander.amplitude : 0;

    if (s.motion === "spiral" && s.spiral) {
      const sp = s.spiral;
      const theta = p.theta0 + Math.PI * 2 * sp.turns * u;
      const r = lerp(sp.radiusFrom, sp.radiusTo, u);
      p.x = sp.center[0] + Math.cos(theta) * r;
      p.y = sp.center[1] + Math.sin(theta) * r + sp.rise * u;
      p.dx = p.x;
      p.dy = p.y;
    } else if (s.motion === "converge" && s.target) {
      const e = smoothstep(u);
      p.x = lerp(p.x0, s.target[0], e);
      p.y = lerp(p.y0, s.target[1], e);
      p.dx = p.x + wobble * (1 - e);
      p.dy = p.y;
    } else {
      p.vy += s.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.dx = p.x + wobble;
      p.dy = p.y;
    }

    // Rien devant les yeux : fondu quand la particule entre dans la zone du visage.
    let target = 1;
    if (this.face && s.avoidFace !== false && insideEllipse([p.dx, p.dy], this.face.center, this.face.radii)) target = 0;
    p.faceAlpha += (target - p.faceAlpha) * Math.min(1, dt * 6);

    p.alpha = fadeAlpha(u, s.fade) * p.faceAlpha;
    p.scale = lerp(s.scaleOverLife[0], s.scaleOverLife[1], u);
  }

  // --- Dessin ---

  private clear(): void {
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private render(): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const a = this.anchor?.();
    if (!a) return;
    const k = a.scale * this.dpr;
    for (const p of this.alive) {
      if (p.alpha <= 0.01) continue;
      const px = (a.x + p.dx * a.scale) * this.dpr;
      const py = (a.y + p.dy * a.scale) * this.dpr;
      drawParticle(ctx, p.spec.shape, px, py, p.size * p.scale * k, p.rot, p.color, p.alpha, p.spec.glow);
    }
  }

  private frame = (now: number): void => {
    this.raf = null;
    if (this.paused || this.reduced) return;
    const dt = this.lastFrame === null ? 16 : Math.min(50, now - this.lastFrame);
    this.lastFrame = now;
    this.step(dt);
    this.render();
    if (this.alive.length > 0 || this.pending.length > 0 || this.continuous.size > 0) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.lastFrame = null;
    }
  };

  private ensureLoop(): void {
    if (this.raf !== null || this.paused || this.reduced || !this.ctx) return;
    this.lastFrame = null;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.lastFrame = null;
  }
}

// --- Formes --------------------------------------------------------------------------------------

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Étincelle à quatre branches aux pointes arrondies ; `pinch` : plus petit = plus fine. */
function sparklePath(ctx: CanvasRenderingContext2D, s: number, pinch: number): void {
  const c = s * pinch;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(c, -c, s, 0);
  ctx.quadraticCurveTo(c, c, 0, s);
  ctx.quadraticCurveTo(-c, c, -s, 0);
  ctx.quadraticCurveTo(-c, -c, 0, -s);
  ctx.closePath();
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  shape: ParticleShape,
  x: number,
  y: number,
  s: number,
  rot: number,
  color: string,
  alpha: number,
  glow: { radius: number; opacity: number },
): void {
  if (s <= 0) return;
  ctx.save();
  ctx.translate(x, y);

  // Lueur peinte en dégradé radial.
  const gr = s * glow.radius;
  if (gr > 0 && glow.opacity > 0) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    g.addColorStop(0, rgba(color, glow.opacity * alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, gr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (shape) {
    case "orb":
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "sparkle4":
      sparklePath(ctx, s, 0.16);
      ctx.fill();
      ctx.lineWidth = s * 0.16;
      ctx.stroke();
      break;
    case "star":
      sparklePath(ctx, s, 0.3);
      ctx.fill();
      ctx.lineWidth = s * 0.2;
      ctx.stroke();
      break;
    case "bubble": {
      const fill = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s);
      fill.addColorStop(0, rgba(color, 0.22));
      fill.addColorStop(1, rgba(color, 0.04));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(1, s * 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.68, Math.PI * 1.1, Math.PI * 1.45);
      ctx.stroke();
      break;
    }
    case "leaf":
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.62, -s * 0.45, s * 0.5, s * 0.55, 0, s);
      ctx.bezierCurveTo(-s * 0.5, s * 0.55, -s * 0.62, -s * 0.45, 0, -s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = Math.max(0.8, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.7);
      ctx.lineTo(0, s * 0.7);
      ctx.stroke();
      break;
    case "moon":
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.arc(s * 0.5, -s * 0.1, s * 0.82, 0, Math.PI * 2);
      ctx.fill("evenodd");
      break;
  }
  ctx.restore();
}
