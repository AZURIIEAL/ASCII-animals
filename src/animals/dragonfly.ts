import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { aaCov, clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.3 / §9.3, reworked for legibility: tapered segmented abdomen, big compound eyes,
// translucent tiled wings with a bright leading vein and a dark pterostigma; hover/dart with a body trail.
const RADIUS = 8.9;
const AB_FRONT = -1.2;
const AB_END = 8.2;
// Fore and hind wing per side: centre, radii, sweep.
const WINGS = [
  { cx: 3.7, cy: -3.0, rx: 3.8, ry: 0.7, rot: -0.12 },
  { cx: 3.45, cy: -1.3, rx: 3.55, ry: 0.82, rot: 0.16 },
];

let S: Stamper;
let cur: Entity;
let palBody = 0;
let palWing = 0;
let palEye = 0;
let shimmer = 0;
let flicker = 1;
let darting = false;
let trails = false;

/** Abdomen radius along v: thick at the base, slender behind, a slight club at the tip. */
function abRadius(v: number): number {
  if (v < 0.6) return 0.66 - 0.2 * smooth(AB_FRONT, 0.6, v);
  return 0.38 + 0.06 * smooth(6.8, 7.8, v);
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // ---- body (tiles) ----
  // Compound eyes: two big bright domes.
  const ex = ax - 0.58;
  const ey = v + 4.25;
  const eyeE = Math.sqrt((ex * ex) / 0.42 + (ey * ey) / 0.34);
  if (eyeE < 1.25) {
    let sh = 0.62 + 0.3 * (1 - clamp01(eyeE));
    const hx = ex + 0.18;
    const hy = ey + 0.15;
    if (hx * hx + hy * hy < 0.06) sh = 0.99;
    S.stamp(col, row, S.tileKey(palEye, sh), aaCov(eyeE * 0.6, 0.6), z + 0.7);
    if (eyeE < 0.8) return;
  }
  const thE = ellipse(u, v, 0, -2.45, 1.05, 1.45, 0);
  const bv = v < AB_FRONT ? AB_FRONT : v > AB_END ? AB_END : v;
  const r = abRadius(bv);
  const dAb = Math.sqrt(u * u + (v - bv) * (v - bv));
  const abCov = aaCov(dAb, r);
  const headCov = aaCov(Math.sqrt(u * u * 1.4 + (v + 3.75) * (v + 3.75)), 0.6);
  const thCov = softCov(thE);
  const cov = Math.max(abCov, thCov, headCov);
  if (cov > 0.04) {
    let sh: number;
    if (thCov >= abCov && thCov >= headCov) {
      // Thorax: lighter shoulder stripes, darker sides.
      sh = 0.5 + 0.18 * smooth(0.35, 0.0, Math.abs(ax - 0.42)) - 0.25 * smooth(0.6, 1.0, thE);
    } else if (abCov >= headCov) {
      // Abdomen: segments with dark joints, a light dorsal line, darker tail end.
      const seg = (bv - AB_FRONT) / 0.92;
      const f = seg - Math.floor(seg);
      sh = 0.56 + 0.16 * (1 - clamp01(dAb / Math.max(r, 0.3)));
      if (f < 0.2) sh -= 0.22;
      if (ax < 0.16 && r > 0.4) sh += 0.1;
      sh -= 0.18 * smooth(6.2, 8.0, bv);
      if (darting && trails) S.trail(col, row, 0.9, palBody, 0.25);
    } else {
      sh = 0.45;
    }
    S.stamp(col, row, S.tileKey(palBody, sh), cov, z + 0.5);
    if (cov > 0.55) return;
  }

  // ---- wings: translucent tiles ----
  const side = u < 0 ? -1 : 1;
  let best = 9;
  let bi = 0;
  let lu = 0;
  let lv = 0;
  for (let i = 0; i < 2; i++) {
    const w = WINGS[i];
    const rot = w.rot + side * shimmer;
    const dx = ax - w.cx;
    const dy = v - w.cy;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const px = dx * c + dy * sn; // along the wing
    const py = -dx * sn + dy * c; // across (negative = leading edge)
    const taper = 0.7 + 0.3 * smooth(-w.rx, -w.rx * 0.4, px); // narrow at the root
    const e = Math.sqrt((px * px) / (w.rx * w.rx) + (py * py) / (w.ry * w.ry * taper * taper));
    if (e < best) {
      best = e;
      bi = i;
      lu = px / w.rx; // -1 root … 1 tip
      lv = py / (w.ry * taper); // -1 leading … 1 trailing
    }
  }
  if (best >= 1.1) return;
  let sh = 0.42 + 0.1 * (1 - best);
  let a = 0.22 + 0.08 * (1 - best);
  if (lv < -0.55) {
    sh = 0.78; // bright leading vein (costa)
    a = 0.5;
  }
  if (lu > 0.62 && lu < 0.82 && lv < -0.2) {
    sh = 0.1; // pterostigma
    a = 0.75;
  }
  if (bi === 1) sh -= 0.05;
  sh += (hash2(Math.floor(lu * 7) + side * 9, Math.floor(lv * 2.5) + cur.id) - 0.5) * 0.08; // cells
  S.stamp(col, row, S.tileKey(palWing, sh), a * softCov(best, 0.8, 1.1) * flicker, z - 0.1);
}

export const dragonfly: AnimalDef = {
  id: 'dragonfly',
  label: 'Dragonfly',
  dot: '#4fd39b',
  baseCount: 12,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    body: ['#03140d', '#073524', '#0c5e3e', '#13875a', '#22b07a', '#4fd39b', '#a7f0cf', '#effff8'],
    wing: ['#0b1416', '#1d3236', '#3f6067', '#7fa5ab', '#c4e2e6', '#f2fdff'],
    eye: ['#04101a', '#0b2c45', '#16557d', '#2b86b5', '#6cc3e8', '#e6f8ff'],
  },
  lineShade: { body: 0.8 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.scale = range(rng, 1.3, 1.65);
    e.seed = range(rng, 0, 1000);
    e.phase = range(rng, 0, 10);
    e.state = 'hover';
    e.stateT = range(rng, 0.3, 1.2);
    if (fromEdge) {
      placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
      e.state = 'dart';
      e.stateT = 0.35;
      e.speed = 550;
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const rng = world.rng;
    e.stateT -= dt;
    e.phase += dt;
    if (e.state === 'hover') {
      const k = Math.exp(-dt * 12);
      e.vx *= k;
      e.vy *= k;
      if (e.stateT <= 0) {
        e.state = 'dart';
        e.stateT = range(rng, 0.15, 0.35);
        e.speed = range(rng, 400, 700) * (1 + 0.5 * e.panic);
        if (e.panic < 0.05) {
          e.heading = rng() < 0.3 ? range(rng, 0, Math.PI * 2) : e.heading + range(rng, -Math.PI / 3, Math.PI / 3);
        }
      }
    } else {
      // Dart: snap to speed along the heading.
      const k = approach(18, dt);
      e.vx += (Math.cos(e.heading) * e.speed - e.vx) * k;
      e.vy += (Math.sin(e.heading) * e.speed - e.vy) * k;
      if (e.stateT <= 0) {
        e.state = 'hover';
        e.stateT = range(rng, 0.3, 1.2) * (e.panic > 0.2 ? 0.4 : 1);
      }
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.state === 'hover') {
      e.x += range(rng, -1.5, 1.5) * dt * 20; // jitter (±1.5 px)
      e.y += range(rng, -1.5, 1.5) * dt * 20;
    }
    const sp = e.vx * e.vx + e.vy * e.vy;
    if (sp > 400) e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(14, dt);
  },

  onScatter(e) {
    // Dart away immediately; the world already pointed the heading away from the click.
    e.state = 'dart';
    e.stateT = 0.3;
    e.speed = 700;
  },

  render(e, s, world) {
    S = s;
    cur = e;
    palBody = this.pal.body;
    palWing = this.pal.wing;
    palEye = this.pal.eye;
    darting = e.state === 'dart';
    trails = world.trailsOn;
    // Wings beat too fast to see: a tiny sweep shimmer plus a flicker in opacity.
    const beat = world.t * 25 * Math.PI * 2 + e.seed;
    shimmer = Math.sin(beat) * 0.06;
    flicker = 0.85 + 0.15 * Math.sin(beat * 0.5);
    s.forEachCell(e, RADIUS, cellFn);
  },
};
