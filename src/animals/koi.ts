import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { easeDrawHeading, placeAtEdge } from './common';
import { clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { EAT_RADIUS } from '../engine/world';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';

// Spec §7.4 / §9.4. A 10-segment spine that wiggles; each cell picks a ramp from the fish's patch pattern.
const N = 10;
const GAP = 1.0;
const V0 = -4.6; // first spine point (head)
const RADII = [1.55, 1.95, 2.05, 1.95, 1.75, 1.5, 1.22, 0.98, 0.76, 0.55]; // taper head → tail
const RADIUS = 8.6; // bounding radius, cells
const HEAD_V = -5.8; // where the mouth is, for eating
const SEP = 70; // px

// Varieties: 0 kohaku (white + red), 1 showa (black + red + white), 2 ogon, 3 yamabuki, 4 chagoi.
const VARIETY_WEIGHTS = [0.35, 0.2, 0.15, 0.15, 0.15];
interface KoiData {
  variety: number;
  pat: number; // pattern offset along the spine
}

// Per-entity render state (module-level so the per-cell callback allocates nothing).
let S: Stamper;
let cur: Entity;
let data: KoiData;
let P: Record<string, number>;
let wig = 0;
const su = new Float32Array(N); // spine u offsets (wiggle)
const sv = new Float32Array(N);

/** Ramp for a cell at spine position s (0..N-1) on side `side` (-1 / 1). */
function rampFor(s: number, side: number, lat: number, r: number): number {
  const d = data;
  // Broad patches along the spine; the side shifts them a little so the two flanks differ.
  const n = vnoise(s * 0.5 + d.pat + side * 0.18 + lat * 0.08);
  const edge = Math.abs(lat) / r; // patches thin out toward the belly line
  switch (d.variety) {
    case 0:
      return n > 0.5 + 0.15 * edge || (s < 1.6 && n > 0.3) ? P.red : P.white;
    case 1: {
      const n2 = vnoise(s * 0.6 + d.pat * 2.3 + side * 0.3);
      if (n > 0.58) return P.red;
      return n2 > 0.62 ? P.white : P.black;
    }
    case 2:
      return P.orange;
    case 3:
      return P.gold;
    default:
      return P.brown;
  }
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  // Body: chain of tapered capsules through the spine points.
  let best = 1e9;
  let bs = 0;
  let blat = 0;
  let br = 1;
  for (let i = 0; i < N - 1; i++) {
    const ax = su[i];
    const ay = sv[i];
    const bx = su[i + 1] - ax;
    const by = sv[i + 1] - ay;
    const px = u - ax;
    const py = v - ay;
    let t = (px * bx + py * by) / (bx * bx + by * by);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - bx * t;
    const dy = py - by * t;
    const r = RADII[i] + (RADII[i + 1] - RADII[i]) * t;
    const e = Math.sqrt(dx * dx + dy * dy) / r;
    if (e < best) {
      best = e;
      bs = i + t;
      blat = dx;
      br = r;
    }
  }
  if (best < 1.12) {
    const cov = softCov(best);
    const side = blat < 0 ? -1 : 1;
    let pal = rampFor(bs, side, blat, br);
    let sh = 0.42 + 0.3 * (1 - clamp01(Math.abs(blat) / br)); // light back, darker sides
    sh -= 0.45 * smooth(0.7, 1.0, best) * sh; // rim
    sh += (hash2(Math.floor(u * 1.5) + 31, Math.floor(v * 1.5) + cur.id * 17) - 0.5) * 0.12; // mottling
    sh -= 0.1 * clamp01((bs - 6) / 3); // tail end a bit darker
    // Head highlight and eyes.
    const hx = u - su[0];
    const hy = v - (sv[0] - 0.2);
    if (hx * hx + hy * hy < 0.2) sh = 0.97;
    const ex = Math.abs(u - su[1]) - 1.15;
    const ey = v - sv[0] - 0.4;
    if (ex * ex + ey * ey < 0.16) {
      pal = P.black;
      sh = 0.05;
    }
    S.stamp(col, row, S.tileKey(pal, sh), cov, z + 0.3);
    if (cov > 0.6) return;
  }

  // Pectoral fins at segment 2: small, swept back, half transparent; they paddle a little.
  const paddle = Math.sin(cur.phase * 3.2) * 0.25;
  const fu = Math.abs(u - su[2]);
  const fe = ellipse(fu, v, RADII[2] + 0.7, sv[2] + 0.7, 1.2, 0.5, 0.65 + paddle);
  // Tail: two splayed lobes after the last segment, swinging with twice the amplitude.
  const tu = u - su[N - 1] - wig;
  const tv = v - sv[N - 1];
  const te = Math.min(ellipse(tu, tv, -0.75, 1.5, 0.55, 1.65, 0.5), ellipse(tu, tv, 0.75, 1.5, 0.55, 1.65, -0.5));
  const e = Math.min(fe, te);
  if (e >= 1.12) return;
  const base = data.variety === 1 ? P.black : rampFor(fe < te ? 2 : N - 1, u < 0 ? -1 : 1, 0, 1);
  let sh = 0.5 - 0.3 * smooth(0.6, 1.0, e);
  sh += (hash2(Math.floor(u * 2), Math.floor(v * 2) + cur.id * 5) - 0.5) * 0.1;
  S.stamp(col, row, S.tileKey(base, sh), softCov(e) * (fe < te ? 0.6 : 0.75), z);
}

// Steering accumulators (module-level: no closures or objects per frame).
let ax = 0;
let ay = 0;
let se: Entity;
function desire(ux: number, uy: number, w: number): void {
  ax += (ux * se.speed - se.vx) * w;
  ay += (uy * se.speed - se.vy) * w;
}
function unit(x: number, y: number, w: number): void {
  const l = Math.sqrt(x * x + y * y);
  if (l > 1e-6) desire(x / l, y / l, w);
}

function steer(e: Entity, world: WorldView, dt: number): void {
  const max = e.speed;
  ax = 0;
  ay = 0;
  se = e;

  // Boids: separation ×1.5, alignment 90 px ×1.0, cohesion 120 px ×0.8.
  // Separation is 70 px, not the spec's 40: a koi is ~100 px long, and at 40 px they pile up.
  let sx = 0;
  let sy = 0;
  let alx = 0;
  let aly = 0;
  let an = 0;
  let cx = 0;
  let cy = 0;
  let cn = 0;
  for (const o of world.entities) {
    if (o === e || o.exiting) continue;
    const dx = o.x - e.x;
    const dy = o.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 120 * 120 || d2 === 0) continue;
    const d = Math.sqrt(d2);
    if (d < SEP) {
      sx -= (dx / d) * (1 - d / SEP);
      sy -= (dy / d) * (1 - d / SEP);
    }
    if (d < 90) {
      alx += o.vx;
      aly += o.vy;
      an++;
    }
    cx += o.x;
    cy += o.y;
    cn++;
  }
  if (sx || sy) unit(sx, sy, 1.5);
  if (an) unit(alx, aly, 1.0);
  if (cn) unit(cx / cn - e.x, cy / cn - e.y, 0.8);

  // Food: seek the nearest pellet within 450 px (weight 2.5).
  let fi = -1;
  let fd = 450 * 450;
  const pel = world.pellets;
  for (let i = 0; i < pel.length; i++) {
    const dx = pel[i].x - e.x;
    const dy = pel[i].y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < fd) {
      fd = d2;
      fi = i;
    }
  }
  if (fi >= 0) {
    unit(pel[fi].x - e.x, pel[fi].y - e.y, 2.5);
  } else {
    // Wander (weight 0.4).
    e.heading += (vnoise(world.t * 0.3 + e.seed) - 0.5) * 2.0 * dt;
    desire(Math.cos(e.heading), Math.sin(e.heading), 0.4);
  }

  e.vx += ax * dt * 1.2;
  e.vy += ay * dt * 1.2;
  const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
  const top = fi >= 0 ? max * 1.3 : max;
  const lo = max * 0.35;
  if (sp > top) {
    e.vx *= top / sp;
    e.vy *= top / sp;
  } else if (sp < lo && sp > 1e-6) {
    e.vx *= lo / sp;
    e.vy *= lo / sp;
  }
}

export const koi: AnimalDef = {
  id: 'koi',
  label: 'Koi',
  dot: '#facc15',
  baseCount: 22,
  radius: RADIUS,
  clickMode: 'feed',
  edge: 'soft',
  palettes: {
    white: ['#1a1a1d', '#3a3a40', '#8a8d96', '#d9dce3', '#ffffff'],
    red: ['#2a0505', '#6b0d0d', '#b91c1c', '#e5483c', '#ff8a75'],
    orange: ['#2a1203', '#6b2a06', '#c2410c', '#f97316', '#fdba74'],
    gold: ['#2a2003', '#6b5306', '#ca8a04', '#facc15', '#fef08a'],
    black: ['#050608', '#14171d', '#262b35', '#3c4352'],
    brown: ['#1c0d03', '#4a2306', '#92400e', '#b45309', '#e0a15c'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 60, Math.max(61, world.w - 60));
    e.y = range(rng, 60, Math.max(61, world.h - 60));
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 60, 90);
    e.vx = Math.cos(e.heading) * e.speed * 0.6;
    e.vy = Math.sin(e.heading) * e.speed * 0.6;
    e.phase = range(rng, 0, 10);
    e.scale = range(rng, 0.8, 1.15);
    e.seed = range(rng, 0, 1000);
    let r = rng();
    let variety = 0;
    while (variety < VARIETY_WEIGHTS.length - 1 && r > VARIETY_WEIGHTS[variety]) r -= VARIETY_WEIGHTS[variety++];
    e.data = { variety, pat: range(rng, 0, 100) } satisfies KoiData;
    if (fromEdge) {
      placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
      e.vx = Math.cos(e.heading) * e.speed;
      e.vy = Math.sin(e.heading) * e.speed;
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    if (!e.exiting) steer(e, world, dt);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    e.phase += dt * (0.5 + sp / e.speed); // swim faster → wiggle faster
    easeDrawHeading(e, dt, 4);

    // Eat: mouth within 10 px of a pellet.
    const k = -HEAD_V * world.cell * e.scale;
    const mx = e.x + Math.cos(e.drawHeading) * k;
    const my = e.y + Math.sin(e.drawHeading) * k;
    const pel = world.pellets;
    for (let i = pel.length - 1; i >= 0; i--) {
      const dx = pel[i].x - mx;
      const dy = pel[i].y - my;
      if (dx * dx + dy * dy < EAT_RADIUS * EAT_RADIUS) world.eatPellet(i);
    }
  },

  render(e, s) {
    S = s;
    cur = e;
    data = e.data as KoiData;
    P = this.pal;
    const amp = 0.7;
    for (let i = 0; i < N; i++) {
      su[i] = Math.sin(e.phase * 6 - i * 0.6) * amp * (i / (N - 1));
      sv[i] = V0 + i * GAP;
    }
    wig = Math.sin(e.phase * 6 - N * 0.6) * amp * 2 - su[N - 1];
    s.forEachCell(e, RADIUS, cellFn);
  },
};
