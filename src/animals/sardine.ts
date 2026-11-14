import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Sardines: small silver fish with a dark blue back and bright flanks that flash as they turn, in a
// tight school. A click startles the nearest fish and the panic ripples through the school, so it
// twists away together.
const RADIUS = 7.2;
const N = 6; // spine points
const GAP = 1.2;
const V0 = -3.4;
const RADII = [0.55, 1.0, 1.08, 0.95, 0.66, 0.4]; // pointed snout, deepest a third back, slim tail stock
const SEP = 100; // px: about one body length, so bodies don't overlap
const ALI = 150;
const COH = 230;

interface SardineData {
  turn: number; // smoothed turn rate, drives the flank flash
}

let S: Stamper;
let cur: Entity;
let pal = 0;
let palBack = 0;
let flash = 0;
const su = new Float32Array(N);
const sv = new Float32Array(N);
let tailU = 0;

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  let best = 9;
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
  if (best < 1.15) {
    const lat = Math.abs(blat) / br;
    // From above: a dark blue-green back, a bright silver band along each flank (it flashes while
    // turning), a row of dark spots on the band, eyes at the sides of the head and a dark gill line.
    let p = palBack;
    let sh = 0.45 + 0.2 * (1 - lat / 0.42) - 0.06 * (bs / (N - 1));
    if (lat > 0.42) {
      p = pal;
      sh = 0.55 + 0.25 * flash + 0.15 * smooth(0.42, 0.7, lat);
      if (bs > 1.3 && bs < 3.6 && lat > 0.5 && lat < 0.8 && Math.abs(((bs * 2.4) % 1) - 0.5) < 0.18) sh = 0.18; // spots
    }
    if (bs > 0.3 && bs < 0.7 && lat > 0.3 && lat < 0.62) {
      p = pal;
      sh = 0.04; // eye
    }
    if (bs > 0.85 && bs < 1.05 && lat > 0.45) sh -= 0.18; // gill line
    sh -= 0.3 * clamp01((best - 0.8) / 0.35) * sh;
    S.stamp(col, row, S.tileKey(p, sh), softCov(best, 0.78, 1.15), z + 0.2);
    return;
  }
  // Forked tail.
  const tu = u - tailU;
  const tv = v - sv[N - 1];
  const te = Math.min(ellipse(tu, tv, -0.6, 1.05, 0.5, 1.15, 0.5), ellipse(tu, tv, 0.6, 1.05, 0.5, 1.15, -0.5));
  if (te < 1.1) S.stamp(col, row, S.tileKey(palBack, 0.5 + 0.15 * flash - 0.15 * clamp01(te)), softCov(te), z);
}

// Steering accumulator (module-level: no closures per frame).
let WX = 0;
let WY = 0;
function add(x: number, y: number, w: number): void {
  const l = Math.sqrt(x * x + y * y);
  if (l > 1e-6) {
    WX += (x / l) * w;
    WY += (y / l) * w;
  }
}

function steer(e: Entity, world: WorldView, dt: number): void {
  let sx = 0;
  let sy = 0;
  let ax = 0;
  let ay = 0;
  let cx = 0;
  let cy = 0;
  let cn = 0;
  let maxPanic = 0;
  for (const o of world.entities) {
    if (o === e) continue;
    const dx = o.x - e.x;
    const dy = o.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > COH * COH || d2 === 0) continue;
    const d = Math.sqrt(d2);
    if (d < SEP) {
      sx -= (dx / d) * (1 - d / SEP);
      sy -= (dy / d) * (1 - d / SEP);
    }
    if (d < ALI) {
      ax += o.vx;
      ay += o.vy;
      if (o.panic > maxPanic && d < 60) maxPanic = o.panic;
    }
    cx += dx;
    cy += dy;
    cn++;
  }
  // Panic spreads through the school as a wave.
  if (maxPanic * 0.85 > e.panic) e.panic += (maxPanic * 0.85 - e.panic) * approach(9, dt);

  WX = Math.cos(e.heading) * 0.3;
  WY = Math.sin(e.heading) * 0.3;
  add(sx, sy, 3.0);
  add(ax, ay, 1.2 + 1.5 * e.panic);
  if (cn) add(cx, cy, 0.55);
  const want = Math.atan2(WY, WX);
  const before = e.heading;
  e.heading += angleDiff(e.heading, want) * approach(3.5 + 4 * e.panic, dt);
  e.heading += (vnoise(world.t * 0.3 + e.seed) - 0.5) * 0.8 * dt;
  const d = e.data as SardineData;
  d.turn += (Math.abs(angleDiff(before, e.heading)) / Math.max(dt, 1e-4) - d.turn) * approach(6, dt);
}

export const sardine: AnimalDef = {
  id: 'sardine',
  label: 'Sardines',
  dot: '#9cc3dc',
  baseCount: 26,
  maxCount: 55,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'soft',
  palettes: {
    body: ['#06101a', '#1a2b38', '#3e5868', '#6f8c9e', '#a8c0cf', '#d8e6ee', '#ffffff'],
    back: ['#03080d', '#0a1c26', '#123241', '#1c4a5c', '#2b6477', '#4a8597'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    // Start as a few loose schools rather than an even scatter.
    const g = Math.floor(rng() * 3);
    const gx = world.w * (0.25 + 0.25 * g);
    const gy = world.h * (0.35 + 0.15 * ((g * 7) % 3));
    e.x = gx + range(rng, -260, 260);
    e.y = gy + range(rng, -170, 170);
    e.heading = g * 2.1 + range(rng, -0.3, 0.3);
    e.speed = range(rng, 70, 105);
    e.scale = range(rng, 1.75, 2.05);
    e.seed = range(rng, 0, 1000);
    e.phase = range(rng, 0, 10);
    e.data = { turn: 0 } satisfies SardineData;
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.vx = Math.cos(e.heading) * e.speed;
    e.vy = Math.sin(e.heading) * e.speed;
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    if (!e.exiting) steer(e, world, dt);
    const sp = e.speed * (1 + 1.6 * e.panic);
    const k = approach(3, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.phase += dt * (1.2 + 1.5 * e.panic);
    e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(10, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.body;
    palBack = this.pal.back;
    const d = e.data as SardineData;
    flash = clamp01(d.turn * 0.6 + e.panic * 0.5);
    const amp = 0.3;
    for (let i = 0; i < N; i++) {
      su[i] = Math.sin(e.phase * 9 - i * 0.9) * amp * (i / (N - 1)) ** 1.5;
      sv[i] = V0 + i * GAP;
    }
    tailU = Math.sin(e.phase * 9 - N * 0.9) * amp * 1.5;
    s.forEachCell(e, RADIUS, cellFn);
  },
};
