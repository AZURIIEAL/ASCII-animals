import type { AnimalDef, CellFn, Entity, Pellet, Pointer, Stamper, WorldView } from '../animals/types';
import type { CellBuffer } from './cellBuffer';
import { animalUnit, type Grid } from './grid';
import type { Trails } from './trails';
import { lineKey, tileKey } from './atlas';
import { G, lineGlyph, type LineGlyph } from './shapes';
import { hash2, mulberry32, range, type Rng } from '../math/rng';

export const PANIC_DECAY = 0.8; // per second
const RIPPLE_GROW = 0.35; // s
const RIPPLE_LIFE = 0.45; // s
const SOFT_BAND = 60; // px
export const PELLET_LIFE = 6; // s
export const EXIT_TIME = 0.8; // s: leaving animals fade out over this (§12)
export const ARRIVE_TIME = 0.6; // s: new animals are staggered in over this
const EXIT_SPEED = 220; // px/s added toward the nearest edge
const GLIDE_TIME = 1.2; // s an arriving animal glides in from off-screen

interface Leaving {
  def: AnimalDef;
  ents: Entity[];
  t: number;
}
export const EAT_RADIUS = 10; // px

interface Ripple {
  x: number;
  y: number;
  t: number;
  R: number;
  pal: number;
  life: number;
}

/** Entity count for an animal (§8.3). */
export function targetCount(base: number, w: number, h: number, density: number, min = 4, max = 80): number {
  const n = Math.round(((base * (w * h)) / (1920 * 1080)) * density * (w < 768 ? 0.6 : 1));
  return Math.max(min, Math.min(max, n));
}

/** Scatter radius (§10). */
export const scatterRadius = (w: number, h: number): number =>
  240 * Math.max(0.6, Math.min(1.4, Math.min(w, h) / 900));

/** Scatter impulse in px/s at distance d (§10). */
export const scatterImpulse = (d: number, R: number): number => (d >= R ? 0 : 900 * (1 - d / R) ** 2);

/** Simulation state + the Stamper animals render through. */
export class World implements Stamper, WorldView {
  entities: Entity[] = [];
  /** True while a switch is still flying animals in or out. */
  get transitioning(): boolean {
    return this.leaving.length > 0 || this.arrived < this.arriveTotal;
  }
  t = 0;
  w = 1;
  h = 1;
  cell = 9;
  size = 1;
  cols = 1;
  rows = 1;
  density = 1;
  countOverride = 0;
  trailsOn = true;
  /** Palette for food pellets (glyph-only cells). */
  foodPal = 0;
  /** Palette for crumbs (tiles). */
  crumbPal = 0;
  pellets: Pellet[] = [];
  pointer: Pointer = { x: 0, y: 0, active: false };
  private ripples: Ripple[] = [];
  private nextId = 1;
  /** Animals flying off after a switch, still driven by their own definition. */
  private leaving: Leaving[] = [];
  private arriveTotal = 0;
  private arrived = 0;
  private arriveT = 0;
  private alphaMul = 1;
  private spawnN = 0;

  constructor(
    public def: AnimalDef,
    readonly rng: Rng,
    private buf: CellBuffer,
    private trails: Trails,
    private seed = 1,
  ) {}

  /**
   * A fresh generator per spawn. Drawing a fixed number of values per entity from one
   * mulberry32 stream correlates badly (e.g. stride 9 from seed 7 puts every y near an edge).
   */
  spawnRng(): Rng {
    return mulberry32((hash2(this.seed, ++this.spawnN) * 4294967296) | 0);
  }

  setGrid(g: Grid): void {
    this.w = g.w;
    this.h = g.h;
    this.cell = g.cell;
    this.size = animalUnit(g.w) / g.cell;
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
    const d = this.def;
    return this.countOverride || targetCount(d.baseCount, this.w, this.h, this.density, d.minCount, d.maxCount);
  }

  /** Grow or shrink to the target count. New entities appear at random positions. */
  syncCount(): void {
    const n = this.targetCount();
    if (this.arrived < this.arriveTotal) {
      this.arriveTotal = n; // still flying in: just retarget
      return;
    }
    while (this.entities.length < n) this.entities.push(this.def.spawn(this, this.spawnRng(), false));
    if (this.entities.length > n) this.entities.length = n;
  }

  /**
   * Switch animals. With `transition`, the current ones fly off toward the nearest edge and fade out
   * while the new ones fly in from the edges, staggered (§12); otherwise the swap is instant.
   */
  setAnimal(def: AnimalDef, transition = false): void {
    if (transition && this.entities.length) {
      for (const e of this.entities) {
        e.exiting = true;
        const l = e.x;
        const r = this.w - e.x;
        const t = e.y;
        const b = this.h - e.y;
        const m = Math.min(l, r, t, b);
        e.exitA = m === l ? Math.PI : m === r ? 0 : m === t ? -Math.PI / 2 : Math.PI / 2;
      }
      this.leaving.push({ def: this.def, ents: this.entities, t: 0 });
      if (this.leaving.length > 2) this.leaving.shift(); // at most ~2× the normal count on screen
    } else {
      this.leaving.length = 0;
      this.trails.clear();
    }
    this.def = def;
    this.entities = [];
    this.pellets.length = 0;
    if (transition) {
      this.arriveTotal = this.targetCount();
      this.arrived = 0;
      this.arriveT = 0;
    } else {
      this.arriveTotal = this.arrived = 0;
      this.syncCount();
    }
  }

  // ---------- simulation ----------

  update(dt: number): void {
    this.t += dt;
    const def = this.def;
    // Fly-in: spawn the new animals from the edges over ARRIVE_TIME.
    if (this.arrived < this.arriveTotal) {
      this.arriveT += dt;
      const want = Math.ceil(this.arriveTotal * Math.min(1, this.arriveT / ARRIVE_TIME));
      while (this.arrived < want) {
        const e = def.spawn(this, this.spawnRng(), true);
        // Glide in, so slow animals don't take ages to appear: cover the distance outside plus a bit,
        // with a push that fades linearly over GLIDE_TIME (distance = v · T / 2).
        const out = Math.max(-e.x, e.x - this.w, -e.y, e.y - this.h);
        if (out > 0) {
          e.arriveV = (2 * (out + 90)) / GLIDE_TIME;
          e.arriveA = e.heading;
          e.arriveT = GLIDE_TIME;
        }
        this.entities.push(e);
        this.arrived++;
      }
    }
    // Fly-out: keep the leaving animals alive (so their tentacles, tails… stay attached), aimed at the edge.
    for (let g = this.leaving.length - 1; g >= 0; g--) {
      const L = this.leaving[g];
      L.t += dt;
      if (L.t > EXIT_TIME) {
        this.leaving.splice(g, 1);
        continue;
      }
      for (const e of L.ents) {
        const a = e.exitA ?? 0;
        e.heading = a;
        e.panic = Math.max(e.panic, 0.6);
        L.def.update(e, dt, this);
        e.x += Math.cos(a) * EXIT_SPEED * dt;
        e.y += Math.sin(a) * EXIT_SPEED * dt;
      }
    }
    for (const e of this.entities) {
      def.update(e, dt, this);
      if (e.arriveT && e.arriveT > 0) {
        const k = (e.arriveV ?? 0) * (e.arriveT / GLIDE_TIME) * dt;
        e.x += Math.cos(e.arriveA ?? 0) * k;
        e.y += Math.sin(e.arriveA ?? 0) * k;
        e.arriveT -= dt;
      }
      e.panic = Math.max(0, e.panic - dt * PANIC_DECAY);
      this.edges(e, dt);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      if ((r.t += dt) > r.life) this.ripples.splice(i, 1);
    }
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      p.t += dt;
      if (p.t > p.life) {
        this.pellets.splice(i, 1);
        continue;
      }
      const k = Math.exp(-dt * 0.6); // drift slows down
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.trails.decay(dt);
  }

  private edges(e: Entity, dt: number): void {
    const mode = this.def.edge;
    if (mode === 'none') return;
    const { w, h } = this;
    const k = 240 * dt; // px/s² toward the inside
    if (mode === 'soft' || mode === 'wrap-vertical') {
      if (e.x < SOFT_BAND) e.vx += k * Math.min(2, 1 - e.x / SOFT_BAND);
      else if (e.x > w - SOFT_BAND) e.vx -= k * Math.min(2, 1 - (w - e.x) / SOFT_BAND);
    }
    if (mode === 'soft') {
      if (e.y < SOFT_BAND) e.vy += k * Math.min(2, 1 - e.y / SOFT_BAND);
      else if (e.y > h - SOFT_BAND) e.vy -= k * Math.min(2, 1 - (h - e.y) / SOFT_BAND);
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

  /** Click at (px, py) in host px. Scatter mode: nearby animals flee. Feed mode: drop pellets. */
  click(px: number, py: number): void {
    const def = this.def;
    const first = Object.keys(def.palettes)[0];
    const pal = def.pal[first] ?? 0;
    if (def.clickMode === 'feed') {
      this.dropFood(px, py);
      this.ripple(px, py, 36, pal, 0.5);
      return;
    }
    if (def.clickMode === 'custom') {
      def.onClick?.(this, px, py);
      return;
    }
    const R = scatterRadius(this.w, this.h);
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
    this.ripple(px, py, R, pal);
  }

  /** 6–12 pellets within 24 px of the click, drifting outward a little. */
  dropFood(px: number, py: number): void {
    const r = this.rng;
    const n = 6 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 24;
      const s = range(r, 2, 10);
      this.pellets.push({
        x: px + Math.cos(a) * d,
        y: py + Math.sin(a) * d,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        t: 0,
        life: PELLET_LIFE,
        kind: 0,
      });
    }
  }

  eatPellet(i: number): void {
    const p = this.pellets[i];
    if (!p) return;
    this.pellets.splice(i, 1);
    const first = Object.keys(this.def.palettes)[0];
    this.ripple(p.x, p.y, 28, this.def.pal[first] ?? 0, 0.6);
  }

  takePellet(i: number): Pellet | undefined {
    const p = this.pellets[i];
    if (p) this.pellets.splice(i, 1);
    return p;
  }

  addPellet(x: number, y: number, life: number, kind: 0 | 1): void {
    this.pellets.push({ x, y, vx: 0, vy: 0, t: 0, life, kind });
  }

  ripple(x: number, y: number, R: number, pal: number, life = RIPPLE_LIFE): void {
    this.ripples.push({ x, y, t: 0, R, pal, life });
  }

  // ---------- rendering ----------

  render(): void {
    this.buf.begin();
    for (const L of this.leaving) {
      this.alphaMul = Math.max(0, 1 - L.t / EXIT_TIME);
      for (const e of L.ents) L.def.render(e, this, this);
    }
    this.alphaMul = 1;
    const def = this.def;
    for (const e of this.entities) def.render(e, this, this);
    this.renderRipples();
    this.renderPellets();
  }

  private renderPellets(): void {
    const c = this.cell;
    const oKey = lineKey(this.foodPal, G.o);
    const dKey = lineKey(this.foodPal, G['·']);
    for (const p of this.pellets) {
      const age = p.t / p.life; // shrinks: 'o' → '·', and fades at the end
      const a = 0.9 * Math.min(1, (1 - age) * 4);
      if (p.kind === 1) this.buf.stamp(Math.floor(p.x / c), Math.floor(p.y / c), tileKey(this.crumbPal, 0.8), a, 50);
      else this.buf.stamp(Math.floor(p.x / c), Math.floor(p.y / c), age < 0.55 ? oKey : dKey, a, 50);
    }
  }

  private renderRipples(): void {
    const c = this.cell;
    for (const rp of this.ripples) {
      const grow = rp.life * (RIPPLE_GROW / RIPPLE_LIFE);
      const rad = rp.R * Math.min(1, rp.t / grow);
      const a = 0.5 * (1 - rp.t / rp.life);
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
    this.buf.stamp(col, row, key, alpha * this.alphaMul, pri);
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
      this.buf.stamp(Math.floor(wx / c), Math.floor(wy / c), lineKey(pal, g), alpha * this.alphaMul, pri);
      px = wx;
      py = wy;
    }
  }

  trail(col: number, row: number, value: number, pal: number, tau: number): void {
    this.trails.add(col, row, value, pal, tau);
  }
}
