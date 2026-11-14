import type { AnimalDef, Entity, Stamper } from './types';
import { easeDrawHeading, placeAtEdge } from './common';
import { clamp01, ellipse, G, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { approach } from '../math/vec2';

// Spec §7.1 / §9.1. Numbers are tuned against reference/butterfly-reference.html.
const SPAN = 9.6; // bounding radius, cells
const FORE = { cx: 4.4, cy: -2.5, rx: 4.4, ry: 2.5, rot: -0.72 }; // big, tip points forward-out
const HIND = { cx: 3.0, cy: 2.5, rx: 2.9, ry: 2.2, rot: 0.8 }; // smaller, rounder, behind

// Per-entity render state, set before forEachCell so the cell callback allocates nothing.
let S: Stamper;
let cur: Entity;
let fold = 1;
let palWing = 0;
let palBody = 0;
const antenna = new Float32Array(16);

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  // Body: thin capsule + head, darkest tiles, drawn above the wings.
  const bv = v < -3.0 ? -3.0 : v > 3.6 ? 3.6 : v;
  const bodyR = v < 0 ? 0.75 : 0.6; // thorax a bit thicker than abdomen
  const dBody = Math.sqrt(u * u + (v - bv) * (v - bv));
  const dHead = Math.sqrt(u * u + (v + 3.9) * (v + 3.9));
  const bodyCov = Math.max(smooth(bodyR + 0.45, bodyR - 0.1, dBody), smooth(1.15, 0.6, dHead));
  if (bodyCov > 0.05) {
    const sh = 0.3 + 0.55 * (1 - clamp01(dBody)) - 0.12 * clamp01(v / 3.6);
    S.stamp(col, row, S.tileKey(palBody, sh), bodyCov, z + 0.5);
    if (bodyCov > 0.6) return;
  }

  // Wings: two ellipses per side, mirrored, squashed by the fold.
  const ax = Math.abs(u) / fold;
  const e1 = ellipse(ax, v, FORE.cx, FORE.cy, FORE.rx, FORE.ry, FORE.rot);
  const e2 = ellipse(ax, v, HIND.cx, HIND.cy, HIND.rx, HIND.ry, HIND.rot);
  const e = Math.min(e1, e2);
  if (e >= 1.12) return;
  const cov = softCov(e);

  let sh = 0.34 + 0.5 * clamp01(ax / 8); // lighter toward the tips
  sh += e1 < e2 ? 0.05 : -0.05; // forewing a touch brighter
  sh -= 0.5 * smooth(0.7, 1.0, e) * sh; // darker rim
  sh -= 0.12 * smooth(1.4, 0.0, ax); // darker where the wing meets the body
  sh += (hash2(Math.floor(ax * 1.8) + (u < 0 ? 97 : 0), Math.floor(v * 1.8) + cur.id * 31) - 0.5) * 0.2; // mottling
  const t1x = ax - 6.6;
  const t1y = v + 4.4;
  const t2x = ax - 6.9;
  const t2y = v + 2.9;
  if (t1x * t1x + t1y * t1y < 0.64 || t2x * t2x + t2y * t2y < 0.36) sh = 0.97; // tip spots
  sh *= 0.62 + 0.38 * fold; // folded wings read darker (seen edge-on)
  S.stamp(col, row, S.tileKey(palWing, sh), cov, z);
}

export const butterfly: AnimalDef = {
  id: 'butterfly',
  label: 'Butterfly',
  dot: '#449ad9',
  baseCount: 26,
  radius: SPAN,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    wing: ['#06101e', '#0c2443', '#17497e', '#2a75b8', '#449ad9', '#6cb7ec', '#a3d6f7', '#eef8ff'],
    body: ['#0b0f1a', '#182033', '#28344d', '#3e4d6b', '#5b6b8c'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 36, 62);
    e.phase = range(rng, 0, 10);
    e.rate = range(rng, 3.4, 4.8);
    e.scale = range(rng, 0.75, 1.3);
    e.seed = range(rng, 0, 1000);
    if (fromEdge) placeAtEdge(e, world, rng, SPAN * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    e.heading += (vnoise(world.t * 0.4 + e.seed) - 0.5) * 3.4 * dt; // smooth wander
    const sp = e.speed * (1 + 2.2 * e.panic);
    const k = approach(1.8, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    const bob = Math.sin(e.phase * 0.5) * 12; // fluttery side-to-side
    e.x += (e.vx - Math.sin(e.heading) * bob) * dt;
    e.y += (e.vy + Math.cos(e.heading) * bob) * dt;
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 0.9 * e.panic);
    easeDrawHeading(e, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    palWing = this.pal.wing;
    palBody = this.pal.body;
    // Wings fold toward the viewer: width 100% → ~16%, continuously. sqrt keeps them open longer.
    fold = 0.16 + 0.84 * Math.sqrt(Math.abs(Math.cos(e.phase)));
    s.forEachCell(e, SPAN, cellFn);

    // Antennae: glyph-only cells, no tiles.
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 8; k++) {
        const t = k / 7;
        antenna[k * 2] = side * (0.3 + 0.5 * t + 1.4 * t * t);
        antenna[k * 2 + 1] = -4.6 - 3.0 * t;
      }
      s.stampLine(e, antenna, 8, palWing, 0.55, e.z - 0.2, G.o);
    }
  },
};
