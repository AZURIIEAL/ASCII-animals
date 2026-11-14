import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { clamp01, ellipse, G, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.2 / §9.2. A pulsing, scalloped bell with follow-the-leader tentacles that leave faint trails.
const RADIUS = 5.6; // bell bounding radius (tentacles are stamped separately)
const TENT = 4; // tentacles
const SEG = 13; // points per tentacle
const ROOTS = [-2.5, -0.85, 0.85, 2.5];
const UP = -Math.PI / 2;
const CONTRACT = 0.4; // s

interface JellyData {
  pts: Float32Array; // world-space tentacle points, TENT × SEG × 2
  init: boolean;
  pulse: number; // -0.3..1, shape only
  lastY?: number;
}

let S: Stamper;
let cur: Entity;
let pal = 0;
let rx = 4.1;
let ry = 3.6;

/** Scalloped cut line of the bell. */
const cutAt = (u: number): number => 0.9 + 0.35 * Math.sin(u * 2.2);

function cellFn(u: number, v: number, col: number, row: number): void {
  const e = ellipse(u, v, 0, 0, rx, ry, 0);
  if (e >= 1.12) return;
  const cut = cutAt(u);
  const cutCov = smooth(cut + 0.3, cut - 0.15, v);
  const cov = softCov(e) * cutCov;
  if (cov < 0.03) return;

  let sh = 0.35 + 0.45 * clamp01(-v / ry); // lighter on top
  sh += 0.15 * smooth(cut - 1.0, cut - 0.2, v); // glowing bottom rim band
  if (ellipse(u, v, 0, -0.4, 2.0, 1.6, 0) < 1) sh -= 0.15; // darker inner core
  sh -= 0.45 * smooth(0.72, 1.0, e) * sh; // rim
  sh += (hash2(Math.floor(u * 1.6) + 7, Math.floor(v * 1.6) + cur.id * 29) - 0.5) * 0.2; // mottling
  const hx = u + 1.3;
  const hy = v + 2.2;
  if (hx * hx + hy * hy < 0.45) sh = 0.97; // highlight near the top
  S.stamp(col, row, S.tileKey(pal, sh), cov * 0.95, cur.z);
}

/** Follow-the-leader tentacle chains in world space, rooted on the bell's rim. */
function simTentacles(e: Entity, d: JellyData, cell: number, t: number): void {
  const k = cell * e.scale;
  const fx = Math.cos(e.drawHeading);
  const fy = Math.sin(e.drawHeading);
  const spacing = 0.95 * k;
  const pts = d.pts;
  for (let ti = 0; ti < TENT; ti++) {
    const lu = ROOTS[ti] * (1 + 0.12 * d.pulse);
    const lv = cutAt(lu) - 0.1;
    const base = ti * SEG * 2;
    const rxw = e.x + (lu * -fy - lv * fx) * k;
    const ryw = e.y + (lu * fx - lv * fy) * k;
    if (!d.init) {
      for (let j = 0; j < SEG; j++) {
        pts[base + j * 2] = rxw - fx * spacing * j;
        pts[base + j * 2 + 1] = ryw - fy * spacing * j;
      }
    }
    pts[base] = rxw;
    pts[base + 1] = ryw;
    for (let j = 1; j < SEG; j++) {
      const i = base + j * 2;
      // Drift backward (away from the heading) and sway, then restore the link length.
      const sway = Math.sin(t * 2.1 + j * 0.7 + ti * 1.3 + e.seed) * 0.08 * k;
      const x = pts[i] - fx * 0.06 * k - fy * sway;
      const y = pts[i + 1] - fy * 0.06 * k + fx * sway;
      const dx = x - pts[i - 2];
      const dy = y - pts[i - 1];
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      pts[i] = pts[i - 2] + (dx / l) * spacing;
      pts[i + 1] = pts[i - 1] + (dy / l) * spacing;
    }
  }
  d.init = true;
}

const TENT_GLYPHS = [G[':'], G[':'], G[':'], G["'"], G["'"], G["'"], G["'"], G['.'], G['.'], G['.'], G['.'], G['.'], G['.']];

export const jellyfish: AnimalDef = {
  id: 'jellyfish',
  label: 'Jellyfish',
  dot: '#d57fe0',
  baseCount: 14,
  radius: RADIUS + 9,
  clickMode: 'scatter',
  edge: 'wrap-vertical',
  palettes: {
    bell: ['#12051a', '#2e0b3d', '#5b1670', '#8a2a9e', '#b44fc4', '#d57fe0', '#efb6f5', '#fff0ff'],
  },
  lineShade: { bell: 0.85 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = UP + range(rng, -0.35, 0.35);
    e.scale = range(rng, 0.9, 1.4);
    e.rate = range(rng, 2, 3); // pulse cycle length, s
    e.speed = range(rng, 60, 90); // pulse impulse, px/s
    e.stateT = range(rng, 0, e.rate);
    e.seed = range(rng, 0, 1000);
    e.data = { pts: new Float32Array(TENT * SEG * 2), init: false, pulse: 0 } satisfies JellyData;
    if (fromEdge) {
      placeAtEdge(e, world, rng, (RADIUS + 9) * e.scale * world.cell);
      e.heading = UP + range(rng, -0.35, 0.35);
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as JellyData;
    // Heading: mostly up, tilted by noise; recovers after a scatter.
    const target = UP + (vnoise(world.t * 0.15 + e.seed) - 0.5) * 0.7;
    e.heading += angleDiff(e.heading, target) * approach(e.panic > 0.05 ? 0.3 : 0.8, dt);

    // Pulse: contract for 0.4 s with an impulse along the heading, then relax with drag.
    const cycle = e.rate * (e.panic > 0.05 ? 0.6 : 1);
    e.stateT += dt;
    if (e.stateT >= cycle) e.stateT -= cycle;
    const t = e.stateT;
    if (t < CONTRACT) {
      const a = (e.speed / CONTRACT) * (1 + e.panic);
      e.vx += Math.cos(e.heading) * a * dt;
      e.vy += Math.sin(e.heading) * a * dt;
      d.pulse = Math.sin((t / CONTRACT) * (Math.PI / 2));
    } else {
      const r = (t - CONTRACT) / (cycle - CONTRACT);
      d.pulse = Math.cos(r * Math.PI) * 0.65 + 0.35 - 0.3 * Math.sin(r * Math.PI); // 1 → overshoot → 0
    }
    const drag = Math.exp(-dt * 1.5);
    e.vx *= drag;
    e.vy *= drag;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(3, dt);
    if (Math.abs(e.y - (d.lastY ?? e.y)) > world.h * 0.5) d.init = false; // wrapped: re-hang the tentacles
    d.lastY = e.y;
    simTentacles(e, d, world.cell, world.t);
  },

  render(e, s, world) {
    S = s;
    cur = e;
    pal = this.pal.bell;
    const d = e.data as JellyData;
    const p = d.pulse;
    rx = 4.1 * (1 + 0.12 * p);
    ry = 3.6 * (1 - 0.1 * p);
    s.forEachCell(e, RADIUS, cellFn);

    // Tentacles (simulated in update): glyph-only cells, fading toward the tips.
    const c = s.cell;
    const pts = d.pts;
    for (let ti = 0; ti < TENT; ti++) {
      const base = ti * SEG * 2;
      for (let j = 1; j < SEG; j++) {
        const col = Math.floor(pts[base + j * 2] / c);
        const row = Math.floor(pts[base + j * 2 + 1] / c);
        const a = 0.55 - (0.35 * j) / (SEG - 1);
        s.stamp(col, row, s.lineKey(pal, TENT_GLYPHS[j]), a, e.z - 0.3);
        if (world.trailsOn && j > 1) s.trail(col, row, 0.55, pal, 1.2);
      }
    }
  },
};
