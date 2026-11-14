import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { localToWorld, placeAtEdge, splatCapsule } from './common';
import { clamp01, ellipse, G, lineGlyph, softCov, type LineGlyph } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Snake (a corn snake): the body follows the exact path the head took, so it slithers in true S-curves.
// Orange with dark red saddles edged in black, a lighter back, scale glints; a wider head with eyes
// and a dark cap; a forked tongue that flicks out. A click makes it bolt away.
const N = 30; // body points
const SPACING = 0.82; // cells between body points (at scale 1)
const HIST = 160; // head-history samples
const HEAD_R = 3.0; // head bounding radius, cells

interface SnakeData {
  hist: Float32Array; // ring buffer of head positions (x, y)
  hi: number; // newest index
  hn: number; // samples stored
  pts: Float32Array; // body points this frame (x, y), head first
  base: number; // base heading the serpentine swings around
  tongue: number; // s left on the current flick
  nextFlick: number;
  boost: number;
}

let S: Stamper;
let cur: Entity;
let palBody = 0;
let palSaddle = 0;
let palTongue = 0;
let segI = 0; // current body segment while splatting
let scaleCells = 1;
const T = { x: 0, y: 0 };
const TIP = { x: 0, y: 0 };
const tongue = new Float32Array(6);

/** Body radius (cells) along the body, s = 0 (neck) … 1 (tail tip). */
function radiusAt(s: number): number {
  if (s < 0.08) return 0.95 + 0.4 * (s / 0.08);
  if (s < 0.55) return 1.35;
  return 1.35 * (1 - (s - 0.55) / 0.45) * 0.9 + 0.12;
}

function bodyKey(t: number, dn: number, col: number, row: number): number {
  const along = (segI + t) * SPACING; // cells from the head
  const f = (along / 2.7 + 0.3) % 1;
  const lat = Math.abs(dn);
  let sh = 0.52 + 0.24 * (1 - lat); // rounded: lighter along the spine
  sh -= 0.3 * clamp01((lat - 0.7) / 0.3) * sh; // rim
  sh += (hash2(col * 3 + 1, row * 7 + cur.id) - 0.5) * 0.08; // scales
  const s = (segI + t) / (N - 1);
  if (s > 0.9) sh -= 0.08;
  // Saddles: dark red blotches with black borders across the back.
  if (lat < 0.82 && f < 0.42) {
    if (f < 0.06 || f > 0.36) return S.tileKey(palSaddle, 0.06);
    return S.tileKey(palSaddle, sh + 0.05);
  }
  return S.tileKey(palBody, sh);
}

function headFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const e = ellipse(u, v, 0, -0.25, 1.55, 1.85, 0);
  if (e >= 1.12) return;
  let pal = palBody;
  let sh = 0.62 + 0.18 * (1 - clamp01(e));
  if (v > -1.1 && Math.abs(u) < 0.95 * (1 - (v + 1.1) / 2.8)) {
    pal = palSaddle; // dark cap
    sh = 0.3;
  }
  const ex = Math.abs(u) - 1.0;
  const ey = v + 0.75;
  const de = ex * ex + ey * ey;
  if (de < 0.2) {
    pal = palSaddle;
    sh = de < 0.05 ? 0.95 : 0.02; // eye with a glint
  }
  if (v < -1.55) sh += 0.08; // pale snout
  S.stamp(col, row, S.tileKey(pal, sh), softCov(e), z + 0.6);
}

function sampleBody(e: Entity, d: SnakeData, cell: number): void {
  // Walk back along the head history and drop a body point every SPACING cells.
  const step = SPACING * cell * e.scale;
  const h = d.hist;
  let px = e.x;
  let py = e.y;
  d.pts[0] = px;
  d.pts[1] = py;
  let k = 1;
  let need = step;
  for (let n = 0; n < d.hn - 1 && k < N; n++) {
    const i = (d.hi - n + HIST) % HIST;
    const x = h[i * 2];
    const y = h[i * 2 + 1];
    let dx = x - px;
    let dy = y - py;
    let l = Math.sqrt(dx * dx + dy * dy);
    while (l >= need && k < N) {
      px += (dx / l) * need;
      py += (dy / l) * need;
      d.pts[k * 2] = px;
      d.pts[k * 2 + 1] = py;
      k++;
      dx = x - px;
      dy = y - py;
      l = Math.sqrt(dx * dx + dy * dy);
      need = step;
    }
    need -= l;
    px = x;
    py = y;
  }
  // Not enough history yet: extend straight back.
  for (; k < N; k++) {
    d.pts[k * 2] = d.pts[(k - 1) * 2] - Math.cos(e.drawHeading) * step;
    d.pts[k * 2 + 1] = d.pts[(k - 1) * 2 + 1] - Math.sin(e.drawHeading) * step;
  }
}

function steerInside(e: Entity, d: SnakeData, world: WorldView, dt: number): void {
  const m = 140;
  if (e.x < m || e.y < m || e.x > world.w - m || e.y > world.h - m) {
    const toC = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x);
    d.base += angleDiff(d.base, toC) * approach(0.9, dt);
  }
}

export const snake: AnimalDef = {
  id: 'snake',
  label: 'Snake',
  dot: '#e8934a',
  baseCount: 5,
  minCount: 2,
  maxCount: 10,
  radius: 4,
  clickMode: 'scatter',
  edge: 'none',
  palettes: {
    body: ['#0c0703', '#2b1607', '#5a2c0c', '#8f4513', '#c4641e', '#e8934a', '#f7c48f'],
    saddle: ['#0a0202', '#2e0806', '#5c120d', '#8a2219', '#b63a2c', '#e9c9c4'],
    tongue: ['#ff6b81', '#ff8a9b'],
  },
  lineShade: { tongue: 1 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 160, Math.max(161, world.w - 160));
    e.y = range(rng, 160, Math.max(161, world.h - 160));
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 36, 56);
    e.rate = range(rng, 0.22, 0.3); // serpentine cycles per second: ~180 px waves at ~45 px/s
    e.phase = range(rng, 0, 10);
    e.scale = range(rng, 1.1, 1.35);
    e.seed = range(rng, 0, 1000);
    const d: SnakeData = {
      hist: new Float32Array(HIST * 2),
      hi: 0,
      hn: 0,
      pts: new Float32Array(N * 2),
      base: e.heading,
      tongue: 0,
      nextFlick: range(rng, 0.5, 2.5),
      boost: 0,
    };
    e.data = d;
    if (fromEdge) {
      placeAtEdge(e, world, rng, 20);
      d.base = e.heading;
    }
    // Pre-roll a straight history behind the head so the body starts laid out. Index 0 is the newest;
    // walking back visits 0, HIST-1, HIST-2…, so sample i (steps back) goes to index (HIST - i) % HIST.
    const step = SPACING * world.cell * e.scale * 0.5;
    d.hi = 0;
    for (let i = 0; i < HIST; i++) {
      const j = (HIST - i) % HIST;
      d.hist[j * 2] = e.x - Math.cos(e.heading) * step * i;
      d.hist[j * 2 + 1] = e.y - Math.sin(e.heading) * step * i;
    }
    d.hn = HIST;
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as SnakeData;
    d.boost = Math.max(0, d.boost - dt);
    d.base += (vnoise(world.t * 0.12 + e.seed) - 0.5) * 0.8 * dt;
    steerInside(e, d, world, dt);
    const fast = 1 + 1.6 * Math.max(e.panic, d.boost > 0 ? 0.8 : 0);
    e.phase += dt * e.rate * Math.PI * 2 * (0.7 + 0.5 * fast);
    e.heading = d.base + Math.sin(e.phase) * 1.0; // ±1 rad: ~30 px side to side
    const sp = e.speed * fast;
    e.vx = Math.cos(e.heading) * sp;
    e.vy = Math.sin(e.heading) * sp;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.drawHeading = e.heading;
    // Record the head path.
    const h = d.hist;
    const lx = h[d.hi * 2];
    const ly = h[d.hi * 2 + 1];
    const minStep = world.cell * e.scale * 0.35;
    if ((e.x - lx) * (e.x - lx) + (e.y - ly) * (e.y - ly) >= minStep * minStep) {
      d.hi = (d.hi + 1) % HIST;
      h[d.hi * 2] = e.x;
      h[d.hi * 2 + 1] = e.y;
      d.hn = Math.min(HIST, d.hn + 1);
    }
    // Tongue flicks.
    d.tongue -= dt;
    d.nextFlick -= dt;
    if (d.nextFlick <= 0) {
      d.tongue = 0.35;
      d.nextFlick = range(world.rng, 1.2, 3.2);
    }
  },

  onScatter(e) {
    const d = e.data as SnakeData;
    d.base = e.heading; // the world pointed it away from the click
    d.boost = 1.6;
  },

  render(e, s) {
    S = s;
    cur = e;
    palBody = this.pal.body;
    palSaddle = this.pal.saddle;
    palTongue = this.pal.tongue;
    const d = e.data as SnakeData;
    const c = s.cell;
    scaleCells = c * e.scale;
    sampleBody(e, d, c);
    // Body: tail first so nearer-the-head segments win overlaps.
    for (let i = N - 2; i >= 0; i--) {
      segI = i;
      const ra = radiusAt(i / (N - 1)) * scaleCells;
      const rb = radiusAt((i + 1) / (N - 1)) * scaleCells;
      splatCapsule(s, d.pts[i * 2], d.pts[i * 2 + 1], d.pts[i * 2 + 2], d.pts[i * 2 + 3], ra, rb, e.z + 0.3 - i * 0.0002, bodyKey);
    }
    s.forEachCell(e, HEAD_R, headFn);
    if (d.tongue > 0) {
      const ext = Math.sin((d.tongue / 0.35) * Math.PI); // out and back
      tongue[0] = 0;
      tongue[1] = -2.1;
      tongue[2] = 0;
      tongue[3] = -2.1 - 1.1 * ext;
      s.stampLine(e, tongue, 2, palTongue, 0.85, e.z + 0.7, G['|']);
      localToWorld(e, c, 0, -2.1 - 1.1 * ext, TIP);
      for (let side = -1; side <= 1; side += 2) {
        localToWorld(e, c, side * 0.4 * ext, -2.1 - 1.6 * ext, T);
        const g = G[lineGlyph(Math.atan2(T.y - TIP.y, T.x - TIP.x)) as LineGlyph];
        s.stamp(Math.floor(T.x / c), Math.floor(T.y / c), s.lineKey(palTongue, g), 0.85, e.z + 0.7);
      }
    }
  },
};
