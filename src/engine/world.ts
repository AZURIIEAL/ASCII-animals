import type { AnimalDef, CellFn, Entity, Stamper, WorldView } from '../animals/types';
import type { CellBuffer } from './cellBuffer';
import type { Grid } from './grid';
import type { Trails } from './trails';
import { lineKey, tileKey } from './atlas';
import { G, lineGlyph, type LineGlyph } from './shapes';
import type { Rng } from '../math/rng';

export const PANIC_DECAY = 0.8; // per second
const RIPPLE_GROW = 0.35; // s
const RIPPLE_LIFE = 0.45; // s
const SOFT_BAND = 60; // px

interface Ripple {
  x: number;
  y: number;
  t: number;
  R: number;
  pal: number;
}

/** Entity count for an animal (§8.3). */
export function targetCount(base: number, w: number, h: number, density: number): number {
  const n = Math.round(((base * (w * h)) / (1920 * 1080)) * density * (w < 768 ? 0.6 : 1));
  return Math.max(4, Math.min(80, n));
}

/** Scatter radius (§10). */
export const scatterRadius = (w: number, h: number): number =>
  240 * Math.max(0.6, Math.min(1.4, Math.min(w, h) / 900));

/** Scatter impulse in px/s at distance d (§10). */
export const scatterImpulse = (d: number, R: number): number => (d >= R ? 0 : 900 * (1 - d / R) ** 2);

/** Simulation state + the Stamper animals render through. */
export class World implements Stamper, WorldView {
  entities: Entity[] = [];
  t = 0;
  w = 1;
  h = 1;
  cell = 9;
  cols = 1;
  rows = 1;
  density = 1;
  countOverride = 0;
  private ripples: Ripple[] = [];
  private nextId = 1;

  constructor(
    public def: AnimalDef,
    readonly rng: Rng,
    private buf: CellBuffer,
    private trails: Trails,
  ) {}

  setGrid(g: Grid): void {
    this.w = g.w;
    this.h = g.h;
    this.cell = g.cell;
    this.cols = g.cols;
    this.rows = g.rows;
    for (const e of this.entities) {
      e.x = Math.min(e.x, this.w);
      e.y = Math.min(e.y, this.h);
    }
  }

  newEntity(): Entity {
    return {
      id: this.nextId++,
      z: this.rng(),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      drawHeading: 0,
      scale: 1,
      phase: 0,
      state: '',
      stateT: 0,
      panic: 0,
      seed: 0,
      speed: 0,
      rate: 1,
    };
  }

  targetCount(): number {
    return this.countOverride || targetCount(this.def.baseCount, this.w, this.h, this.density);
  }

  /** Grow or shrink to the target count. New entities appear at random positions. */
  syncCount(): void {
    const n = this.targetCount();
    while (this.entities.length < n) this.entities.push(this.def.spawn(this, this.rng, false));
    if (this.entities.length > n) this.entities.length = n;
  }

  /** Replace the population (M5 adds fly-out / fly-in transitions). */
  setAnimal(def: AnimalDef): void {
    this.def = def;
    this.entities.length = 0;
    this.trails.clear();
    this.syncCount();
  }

  // ---------- simulation ----------

  update(dt: number): void {
    this.t += dt;
    const def = this.def;
    for (const e of this.entities) {
      def.update(e, dt, this);
      e.panic = Math.max(0, e.panic - dt * PANIC_DECAY);
      this.edges(e, dt);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      if ((this.ripples[i].t += dt) > RIPPLE_LIFE) this.ripples.splice(i, 1);
    }
    this.trails.decay(dt);
  }

  private edges(e: Entity, dt: number): void {
    const mode = this.def.edge;
    const { w, h } = this;
    if (mode === 'soft') {
      const k = 240 * dt; // px/s² toward the inside
      if (e.x < SOFT_BAND) e.vx += k * (1 - e.x / SOFT_BAND);
      else if (e.x > w - SOFT_BAND) e.vx -= k * (1 - (w - e.x) / SOFT_BAND);
      if (e.y < SOFT_BAND) e.vy += k * (1 - e.y / SOFT_BAND);
      else if (e.y > h - SOFT_BAND) e.vy -= k * (1 - (h - e.y) / SOFT_BAND);
      return;
    }
    const m = this.def.radius * e.scale * this.cell;
    if (mode === 'wrap') {
      if (e.x < -m) e.x += w + 2 * m;
      else if (e.x > w + m) e.x -= w + 2 * m;
    }
    if (e.y < -m) e.y += h + 2 * m;
    else if (e.y > h + m) e.y -= h + 2 * m;
  }

  /** Click at (px, py) in host px. Scatter-mode animals flee; feed mode is handled per animal (M3). */
  click(px: number, py: number): void {
    const def = this.def;
    const R = scatterRadius(this.w, this.h);
    if (def.clickMode === 'scatter') {
      for (const e of this.entities) {
        const dx = e.x - px;
        const dy = e.y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= R) continue;
        const k = (1 - d / R) ** 2;
        const nx = d ? dx / d : 1;
        const ny = d ? dy / d : 0;
        e.vx += nx * 900 * k;
        e.vy += ny * 900 * k;
        e.heading = Math.atan2(ny, nx); // keep fleeing, don't turn straight back
        e.panic = Math.max(e.panic, k);
        def.onScatter?.(e, px, py, k);
      }
    }
    const first = Object.keys(def.palettes)[0];
    this.ripples.push({ x: px, y: py, t: 0, R, pal: def.pal[first] ?? 0 });
  }

  // ---------- rendering ----------

  render(): void {
    this.buf.begin();
    const def = this.def;
    for (const e of this.entities) def.render(e, this, this);
    this.renderRipples();
  }

  private renderRipples(): void {
    const c = this.cell;
    for (const rp of this.ripples) {
      const rad = rp.R * Math.min(1, rp.t / RIPPLE_GROW);
      const a = 0.5 * (1 - rp.t / RIPPLE_LIFE);
      const n = Math.max(8, Math.round((2 * Math.PI * rad) / (c * 2)));
      const key = lineKey(rp.pal, G['·']);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        this.buf.stamp(Math.floor((rp.x + Math.cos(t) * rad) / c), Math.floor((rp.y + Math.sin(t) * rad) / c), key, a, -5);
      }
    }
  }

  // ---------- Stamper ----------

  stamp(col: number, row: number, key: number, alpha: number, pri: number): void {
    this.buf.stamp(col, row, key, alpha, pri);
  }

  tileKey(pal: number, shade: number): number {
    return tileKey(pal, shade);
  }

  lineKey(pal: number, glyph: number): number {
    return lineKey(pal, glyph);
  }

  forEachCell(e: Entity, radius: number, fn: CellFn): void {
    const c = this.cell;
    const fx = Math.cos(e.drawHeading);
    const fy = Math.sin(e.drawHeading);
    const inv = 1 / (c * e.scale);
    const R = Math.ceil(radius * e.scale) + 1;
    const r2 = radius * radius;
    const c0 = Math.floor(e.x / c);
    const r0 = Math.floor(e.y / c);
    const rowA = Math.max(0, r0 - R);
    const rowB = Math.min(this.rows - 1, r0 + R);
    const colA = Math.max(0, c0 - R);
    const colB = Math.min(this.cols - 1, c0 + R);
    for (let row = rowA; row <= rowB; row++) {
      const dy = (row + 0.5) * c - e.y;
      for (let col = colA; col <= colB; col++) {
        const dx = (col + 0.5) * c - e.x;
        const u = (dx * -fy + dy * fx) * inv;
        const v = -(dx * fx + dy * fy) * inv;
        if (u * u + v * v > r2) continue;
        fn(u, v, col, row);
      }
    }
  }

  stampLine(e: Entity, pts: ArrayLike<number>, n: number, pal: number, alpha: number, pri: number, tip: number): void {
    const c = this.cell;
    const k = c * e.scale;
    const fx = Math.cos(e.drawHeading);
    const fy = Math.sin(e.drawHeading);
    let px = 0;
    let py = 0;
    for (let i = 0; i < n; i++) {
      const lu = pts[i * 2];
      const lv = pts[i * 2 + 1];
      // local → world: u along right (-fy, fx), v along -forward
      const wx = e.x + (lu * -fy - lv * fx) * k;
      const wy = e.y + (lu * fx - lv * fy) * k;
      let g: number;
      if (i === n - 1) g = tip;
      else if (i === 0) g = G['.'];
      else g = G[lineGlyph(Math.atan2(wy - py, wx - px)) as LineGlyph];
      this.buf.stamp(Math.floor(wx / c), Math.floor(wy / c), lineKey(pal, g), alpha, pri);
      px = wx;
      py = wy;
    }
  }

  trail(col: number, row: number, value: number, pal: number, tau: number): void {
    this.trails.add(col, row, value, pal, tau);
  }
}
