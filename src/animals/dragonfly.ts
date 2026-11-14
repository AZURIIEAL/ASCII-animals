import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { clamp01, ellipse, G, lineGlyph, smooth, softCov, type LineGlyph } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.3 / §9.3. Slim banded body, glyph-only shimmering wings, hover/dart with a body trail.
const RADIUS = 6.6;
const WINGS = [
  { cx: 3.0, cy: -1.7, rx: 3.1, ry: 0.75 }, // fore
  { cx: 2.8, cy: -0.5, rx: 2.9, ry: 0.8 }, // hind
];

let S: Stamper;
let cur: Entity;
let palBody = 0;
let palWing = 0;
let shimmer = 0;
let edgeGlyph = 0; // '-' glyph oriented to the wing's on-screen direction
let darting = false;
let trails = false;

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  // Body parts (tiles).
  const bv = v < -1.0 ? -1.0 : v > 5.8 ? 5.8 : v;
  const dAb = Math.sqrt(u * u + (v - bv) * (v - bv));
  const abCov = smooth(0.45 + 0.5, 0.45 - 0.05, dAb) * smooth(6.6, 5.6, v); // tapering tip
  const thE = ellipse(u, v, 0, -1.8, 0.85, 1.2, 0);
  const hx = u;
  const hy = v + 3.4;
  const dHead = Math.sqrt(hx * hx + hy * hy);
  const thCov = softCov(thE);
  const headCov = smooth(0.75 + 0.45, 0.75 - 0.1, dHead);
  const cov = Math.max(abCov, thCov, headCov);
  if (cov > 0.05) {
    let sh: number;
    if (abCov >= thCov && abCov >= headCov) {
      sh = (Math.floor(v) & 1) === 0 ? 0.55 : 0.75; // banding
      sh -= 0.2 * clamp01(dAb / 0.9);
      if (darting && trails) S.trail(col, row, 0.9, palBody, 0.25);
    } else if (thCov >= headCov) {
      sh = 0.45 + 0.3 * (1 - clamp01(thE)) + (hash2(col, row + cur.id * 7) - 0.5) * 0.12;
    } else {
      sh = 0.5 + 0.2 * (1 - clamp01(dHead / 0.8));
    }
    // Two big eyes.
    const ex = Math.abs(u) - 0.5;
    const ey = v + 3.6;
    if (ex * ex + ey * ey < 0.16) sh = 0.97;
    S.stamp(col, row, S.tileKey(palBody, sh), cov, z + 0.5);
    if (cov > 0.6) return;
  }

  // Wings: glyph-only cells. '.' / ':' inside, '-' (oriented) on the edge.
  const ax = Math.abs(u);
  const rot = (u < 0 ? -1 : 1) * shimmer;
  let best = 9;
  for (let i = 0; i < 2; i++) {
    const w = WINGS[i];
    const e = ellipse(ax, v, w.cx, w.cy, w.rx, w.ry, rot);
    if (e < best) best = e;
  }
  if (best >= 1.08) return;
  const glyph = best > 0.78 ? edgeGlyph : hash2(col * 3 + 1, row + cur.id) < 0.35 ? G['.'] : G[':'];
  S.stamp(col, row, S.lineKey(palWing, glyph), 0.45 + 0.15 * (1 - best), z - 0.1);
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
    wing: ['#0d1a1d', '#cfe8ee'],
  },
  lineShade: { wing: 1, body: 0.8 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.scale = range(rng, 1.15, 1.55);
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
    darting = e.state === 'dart';
    trails = world.trailsOn;
    shimmer = Math.sin(world.t * 25 * Math.PI * 2 + e.seed) * 0.12;
    edgeGlyph = G[lineGlyph(e.drawHeading + Math.PI / 2) as LineGlyph];
    s.forEachCell(e, RADIUS, cellFn);
  },
};
