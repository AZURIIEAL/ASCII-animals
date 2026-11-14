import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { clamp01, smooth } from '../engine/shapes';
import { range } from '../math/rng';
import { vnoise } from '../math/noise';
import { approach } from '../math/vec2';

// Fireflies: a bright core inside a soft breathing halo, a dim body when unlit, faint light trails.
// Neighbours slowly pull their blink phases together, so patches of the field pulse in sync.
const RADIUS = 5.4;
const SYNC_R = 160; // px
const SYNC_K = 0.35; // phase coupling strength

let S: Stamper;
let cur: Entity;
let glow = 0;
let palGlow = 0;
let palBody = 0;
let haloR = 1;

/** Light envelope over one blink cycle (phase 0..1): quick rise, slower fade, then dark. */
function envelope(p: number): number {
  if (p < 0.08) return smooth(0, 0.08, p);
  if (p < 0.42) return 1 - smooth(0.12, 0.42, p);
  return 0;
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const d = Math.sqrt(u * u + v * v);
  const z = cur.z;
  if (d < 0.75) {
    // Core: the lantern when lit, a dim brown body when dark.
    if (glow > 0.12) S.stamp(col, row, S.tileKey(palGlow, 0.55 + 0.45 * glow), 0.55 + 0.45 * glow, z + 1);
    else S.stamp(col, row, S.tileKey(palBody, 0.7), 0.32, z + 1);
    return;
  }
  if (glow < 0.04 || d > haloR) return;
  // Halo: falls off softly; the outer ring uses darker shades so it reads as light, not a disc.
  const f = 1 - d / haloR;
  const a = glow * Math.pow(f, 1.4) * 0.95;
  if (a < 0.04) return;
  S.stamp(col, row, S.tileKey(palGlow, 0.3 + 0.6 * f * glow), a, z);
}

export const firefly: AnimalDef = {
  id: 'firefly',
  label: 'Firefly',
  dot: '#d9f25a',
  baseCount: 46,
  maxCount: 90,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    glow: ['#0b0f02', '#2d3a06', '#5f7a0c', '#a3c41a', '#d9f25a', '#f6ffc2'],
    body: ['#0a0907', '#1f1a12', '#3a3022', '#5a4a34', '#7d6a4c'],
  },
  lineShade: { glow: 0.85 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 14, 34);
    e.rate = range(rng, 0.2, 0.36); // blink cycles per second (2.8–5 s period)
    e.phase = rng(); // blink phase 0..1
    e.scale = range(rng, 0.65, 1.4);
    e.seed = range(rng, 0, 1000);
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    // Lazy wandering flight with a slow vertical bob.
    e.heading += (vnoise(world.t * 0.25 + e.seed) - 0.5) * 2.6 * dt;
    const sp = e.speed * (1 + 3 * e.panic);
    const k = approach(1.2, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += (e.vy + Math.sin(world.t * 1.3 + e.seed) * 6) * dt;

    // Blink, nudged toward neighbours' phases (Kuramoto-style), so the field syncs up over time.
    let pull = 0;
    for (const o of world.entities) {
      if (o === e) continue;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      if (dx * dx + dy * dy > SYNC_R * SYNC_R) continue;
      pull += Math.sin((o.phase - e.phase) * Math.PI * 2);
    }
    e.phase += dt * (e.rate + SYNC_K * 0.05 * Math.max(-3, Math.min(3, pull)));
    e.phase -= Math.floor(e.phase);
    e.drawHeading = e.heading;
  },

  onScatter(e) {
    e.phase = 0.02; // startled: flash
  },

  render(e, s, world) {
    S = s;
    cur = e;
    palGlow = this.pal.glow;
    palBody = this.pal.body;
    glow = Math.max(envelope(e.phase), e.panic * 0.9);
    haloR = 1.4 + 3.8 * glow;
    s.forEachCell(e, RADIUS, cellFn);
    if (world.trailsOn && glow > 0.2) {
      const c = s.cell;
      s.trail(Math.floor(e.x / c), Math.floor(e.y / c), 0.5 * clamp01(glow), palGlow, 0.8);
    }
  },
};
