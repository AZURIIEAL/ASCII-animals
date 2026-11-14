import type { AnimalDef, Entity } from '../animals/types';
import { getAnimal } from '../animals/registry';
import { mulberry32, type Rng } from '../math/rng';
import { clamp, type Vec2 } from '../math/vec2';
import type { AnimalId, Theme, Tweaks } from '../types';
import { CellBuffer } from './cellBuffer';
import { Grid } from './grid';
import { glyphIndex, Palette } from './palette';
import { Trails } from './trails';

/** Base count assumes a 1920×1080 host at density 1. */
export const REFERENCE_AREA = 1920 * 1080;

export function entityCount(
  baseCount: number,
  hostWidth: number,
  hostHeight: number,
  density: number,
): number {
  const area = hostWidth * hostHeight;
  const mobile = hostWidth < 768 ? 0.6 : 1;
  const n = Math.round(baseCount * (area / REFERENCE_AREA) * density * mobile);
  return clamp(n, 4, 80);
}

export const SCATTER_IMPULSE = 900;
export const PANIC_DECAY = 0.8;

export function scatterRadius(width: number, height: number): number {
  return 240 * clamp(Math.min(width, height) / 900, 0.6, 1.4);
}

/** Expanding ring of dim cells drawn at a click point. */
interface Ring {
  x: number;
  y: number;
  /** seconds elapsed */
  t: number;
  /** total lifetime */
  life: number;
  /** final radius, px */
  radius: number;
  color: number;
}

const SOFT_BAND = 60;
const SOFT_FORCE = 260; // px/s² at the very edge of the band
const SPAWN_RATE = 10; // entities added or retired per second when density changes
const EXIT_TIME = 0.8;

export class World {
  readonly grid = new Grid();
  readonly palette: Palette;
  readonly buffer = new CellBuffer();
  readonly trails = new Trails();
  entities: Entity[] = [];
  def: AnimalDef;
  rng: Rng;
  tweaks: Tweaks;
  theme: Theme;
  /** Pellets and other per-animal extras live here from Milestone 3 onward. */
  rings: Ring[] = [];
  private spawnDebt = 0;
  private readonly inited = new Set<AnimalId>();
  private dimColor = 0;

  constructor(tweaks: Tweaks, theme: Theme, animal: AnimalId, seed: number) {
    this.tweaks = tweaks;
    this.theme = theme;
    this.palette = new Palette(theme);
    this.rng = mulberry32(seed);
    this.def = getAnimal(animal);
    this.dimColor = this.palette.register('#9ca3af');
    this.useAnimal(this.def);
  }

  private useAnimal(def: AnimalDef): void {
    if (!this.inited.has(def.id)) {
      def.init?.(this);
      this.inited.add(def.id);
    }
  }

  resize(width: number, height: number, cell: number, dpr: number): boolean {
    const changed = this.grid.set(width, height, cell, dpr);
    if (changed) {
      this.buffer.resize(this.grid.cols, this.grid.rows);
      this.trails.resize(this.grid.cols, this.grid.rows);
      // Keep the entities; just pull them back inside the new bounds.
      for (const e of this.entities) {
        e.x = clamp(e.x, 0, this.grid.width);
        e.y = clamp(e.y, 0, this.grid.height);
      }
    }
    return changed;
  }

  get targetCount(): number {
    return entityCount(
      this.def.baseCount,
      this.grid.width,
      this.grid.height,
      this.tweaks.density,
    );
  }

  /** Fills the field immediately (used on first mount and after a reduced-motion reset). */
  populate(): void {
    this.entities.length = 0;
    const n = this.targetCount;
    for (let i = 0; i < n; i++) this.entities.push(this.def.spawn(this, this.rng, false));
  }

  /** Puts an entity just outside a random edge, heading inward. */
  placeOffEdge(e: Entity, rng: Rng, margin: number): void {
    const m = margin + 8;
    const side = rng.int(0, 3);
    const { width: w, height: h } = this.grid;
    if (side === 0) {
      e.x = -m;
      e.y = rng.range(0, h);
      e.heading = rng.range(-0.6, 0.6);
    } else if (side === 1) {
      e.x = w + m;
      e.y = rng.range(0, h);
      e.heading = Math.PI + rng.range(-0.6, 0.6);
    } else if (side === 2) {
      e.x = rng.range(0, w);
      e.y = -m;
      e.heading = Math.PI / 2 + rng.range(-0.6, 0.6);
    } else {
      e.x = rng.range(0, w);
      e.y = h + m;
      e.heading = -Math.PI / 2 + rng.range(-0.6, 0.6);
    }
  }

  /** Switches animals: current entities fly off, the new ones fly in (§11). */
  setAnimal(id: AnimalId): void {
    const def = getAnimal(id);
    if (def.id === this.def.id) return;
    for (const e of this.entities) {
      e.exiting = true;
      e.exitT = 0;
    }
    this.def = def;
    this.useAnimal(def);
    this.spawnDebt = 0;
    this.pendingIn = this.targetCount;
    this.staggerT = 0;
  }

  private pendingIn = 0;
  private staggerT = 0;

  update(dt: number): void {
    const cap = this.targetCount * 2;

    // Staggered arrivals during a switch, over 0.6 s.
    if (this.pendingIn > 0) {
      this.staggerT += dt;
      const per = 0.6 / Math.max(1, this.pendingIn);
      while (this.pendingIn > 0 && this.staggerT >= per && this.entities.length < cap) {
        this.staggerT -= per;
        this.pendingIn--;
        this.entities.push(this.def.spawn(this, this.rng, true));
      }
    } else {
      // Gradual top-up / retire when the density tweak changes, ~10/s.
      const target = this.targetCount;
      let live = this.entities.filter((e) => !e.exiting).length;
      if (live === target) {
        this.spawnDebt = 0;
      } else {
        this.spawnDebt += SPAWN_RATE * dt;
        while (this.spawnDebt >= 1 && live !== target) {
          this.spawnDebt -= 1;
          if (live < target && this.entities.length < cap) {
            this.entities.push(this.def.spawn(this, this.rng, true));
            live++;
          } else if (live > target) {
            const victim = this.entities.find((e) => !e.exiting);
            if (!victim) break;
            victim.exiting = true;
            victim.exitT = 0;
            live--;
          } else {
            break;
          }
        }
      }
    }

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.panic > 0) e.panic = Math.max(0, e.panic - PANIC_DECAY * dt);
      if (e.exiting) {
        this.updateExiting(e, dt);
        if ((e.exitT ?? 0) >= EXIT_TIME || this.farOutside(e)) {
          this.entities.splice(i, 1);
          continue;
        }
      }
      this.def.update(e, dt, this);
      if (!e.exiting) this.applyEdges(e, dt);
    }

    if (this.tweaks.trails) this.trails.decay(dt);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
  }

  private updateExiting(e: Entity, dt: number): void {
    e.exitT = (e.exitT ?? 0) + dt;
    e.fade = Math.max(0, 1 - e.exitT / EXIT_TIME);
    // Steer toward the nearest edge.
    const { width: w, height: h } = this.grid;
    const left = e.x;
    const right = w - e.x;
    const top = e.y;
    const bottom = h - e.y;
    const min = Math.min(left, right, top, bottom);
    const target =
      min === left ? Math.PI : min === right ? 0 : min === top ? -Math.PI / 2 : Math.PI / 2;
    e.heading = target;
  }

  private farOutside(e: Entity): boolean {
    const m = 120;
    return (
      e.x < -m || e.y < -m || e.x > this.grid.width + m || e.y > this.grid.height + m
    );
  }

  private applyEdges(e: Entity, dt: number): void {
    const { width: w, height: h } = this.grid;
    const m = this.grid.cell * 8;
    switch (this.def.edge) {
      case 'wrap':
        if (e.x < -m) e.x = w + m;
        else if (e.x > w + m) e.x = -m;
        if (e.y < -m) e.y = h + m;
        else if (e.y > h + m) e.y = -m;
        break;
      case 'wrap-vertical':
        if (e.y < -m) e.y = h + m;
        else if (e.y > h + m) e.y = -m;
        this.softX(e, w, dt);
        break;
      case 'soft':
        this.softX(e, w, dt);
        this.softY(e, h, dt);
        break;
    }
  }

  /** Inside a 60 px band, steer back toward the centre, in proportion to depth. */
  private softX(e: Entity, w: number, dt: number): void {
    const band = SOFT_BAND;
    if (e.x < band) e.vx += ((band - e.x) / band) * SOFT_FORCE * dt;
    else if (e.x > w - band) e.vx -= ((e.x - (w - band)) / band) * SOFT_FORCE * dt;
  }

  private softY(e: Entity, h: number, dt: number): void {
    const band = SOFT_BAND;
    if (e.y < band) e.vy += ((band - e.y) / band) * SOFT_FORCE * dt;
    else if (e.y > h - band) e.vy -= ((e.y - (h - band)) / band) * SOFT_FORCE * dt;
  }

  /** §9.2 — push entities away from a click, with quadratic falloff. */
  scatter(p: Vec2): void {
    if (this.def.clickMode === 'feed') return;
    const R = scatterRadius(this.grid.width, this.grid.height);
    for (const e of this.entities) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      const k = (1 - d / R) ** 2;
      const nx = d === 0 ? 0 : dx / d;
      const ny = d === 0 ? -1 : dy / d;
      e.vx += nx * SCATTER_IMPULSE * k;
      e.vy += ny * SCATTER_IMPULSE * k;
      e.panic = Math.max(e.panic, k);
      this.def.onScatter?.(e, p, k);
    }
    this.addRing(p.x, p.y, R, 0.35);
  }

  addRing(x: number, y: number, radius: number, life: number, color = this.dimColor): void {
    this.rings.push({ x, y, t: 0, life, radius, color });
  }

  /** Rebuilds the cell buffer for this frame. */
  render(): void {
    this.buffer.clear();
    for (const e of this.entities) this.def.render(e, this.buffer, this.trails, this);
    this.renderRings();
  }

  private readonly dotGlyph = glyphIndex('.');

  private renderRings(): void {
    const c = this.grid.cell;
    for (const r of this.rings) {
      const t = r.t / r.life;
      const radius = (r.radius * t) / c; // in cells
      const alpha = (1 - t) * 0.5;
      if (alpha <= 0.01 || radius < 0.5) continue;
      const steps = Math.max(12, Math.round(radius * 6));
      const col0 = this.grid.colAt(r.x);
      const row0 = this.grid.rowAt(r.y);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const col = col0 + Math.round(Math.cos(a) * radius);
        const row = row0 + Math.round(Math.sin(a) * radius);
        this.buffer.stamp(col, row, r.color, this.dotGlyph, alpha, 1);
      }
    }
  }
}
