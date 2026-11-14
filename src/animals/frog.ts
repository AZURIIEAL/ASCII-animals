import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { aaCov, capsule, clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { vnoise2 } from '../math/noise';
import { hash2, range, type Rng } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.5 / §9.5. Sit → crouch → jump → land, with legs that stretch back while airborne.
const RADIUS = 7.9;
const CROUCH = 0.15;
const LAND = 0.1;

interface FrogData {
  baseScale: number;
  blinkIn: number; // s until the next blink
  blink: number; // > 0 while the eyes are shut
  sx: number; // jump start
  sy: number;
  dist: number; // jump length, px
  dur: number; // jump duration, s
  leg: number; // 0 tucked … 1 fully stretched
}

let S: Stamper;
let cur: Entity;
let data: FrogData;
let pal = 0;
let blotch = 0; // per-frog noise offset
// Leg joints (local cells, right side; mirrored), updated per frog from the leg extension.
let kneeX = 3.3;
let kneeY = 0.6;
let ankX = 2.7;
let ankY = 3.4;
let toeX = 3.6;
let toeY = 4.6;

/** Smooth minimum, for merging the head and body into one silhouette. */
function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // ---- eyes: golden domes with a horizontal pupil ----
  const ex = ax - 1.3;
  const ey = v + 2.6;
  const dEye = Math.sqrt(ex * ex + ey * ey);
  if (dEye < 1.0) {
    // Pale green bulge; the pupil sits toward the front-inner side so it lands on a whole cell.
    let sh = 0.82 + 0.1 * (1 - clamp01(dEye / 0.6));
    const px = ax - 1.18;
    const py = v + 2.78;
    if (dEye > 0.85) sh = 0.3;
    else if (data.blink > 0) sh = 0.5;
    else if (px * px + py * py < 0.18) sh = 0.03; // pupil
    S.stamp(col, row, S.tileKey(pal, sh), aaCov(dEye, 0.8), z + 0.6);
    if (dEye < 0.7) return;
  }

  // ---- body + head, merged ----
  const eb = ellipse(u, v, 0, 0.45, 2.3, 2.85, 0);
  const eh = ellipse(u, v, 0, -1.9, 2.05, 1.55, 0);
  const e = smin(eb, eh, 0.35);
  if (e < 1.12) {
    let sh = 0.44 + 0.12 * clamp01((-v + 0.5) / 3.5); // head a little lighter
    sh += 0.14 * smooth(0.32, 0.0, Math.abs(ax - 1.05)) * smooth(-2.4, -1.4, v) * smooth(3.0, 2.0, v); // ridges
    sh -= 0.18 * smooth(1.2, 2.3, ax); // darker flanks
    const n = vnoise2(u * 0.8 + blotch, v * 0.8 + blotch * 0.7);
    sh -= 0.2 * smooth(0.6, 0.72, n) * smooth(-2.6, -1.6, v); // soft dark blotches (not on the snout)
    sh -= 0.45 * smooth(0.72, 1.02, e) * sh; // rim
    sh += (hash2(Math.floor(u * 1.7), Math.floor(v * 1.7) + cur.id * 3) - 0.5) * 0.06;
    if (v < -3.0 && ax < 0.9) sh += 0.08; // pale snout tip
    S.stamp(col, row, S.tileKey(pal, sh), softCov(e), z + 0.4);
    if (e < 0.9) return;
  }

  // ---- legs: darker, banded, separated from the body by their shade ----
  const dThigh = capsule(ax, v, 1.6, 1.9, kneeX, kneeY);
  const dShin = capsule(ax, v, kneeX, kneeY, ankX, ankY);
  const dFoot = capsule(ax, v, ankX, ankY, toeX, toeY);
  const dToes = Math.min(
    capsule(ax, v, toeX, toeY, toeX + 0.75, toeY + 0.25),
    capsule(ax, v, toeX, toeY, toeX + 0.15, toeY + 0.85),
    capsule(ax, v, toeX, toeY, toeX - 0.55, toeY + 0.65),
  );
  const dUpper = capsule(ax, v, 1.5, -0.9, 2.45, -1.35);
  const dFore = capsule(ax, v, 2.45, -1.35, 2.35, -2.55);
  const dFingers = Math.min(
    capsule(ax, v, 2.35, -2.55, 2.85, -2.95),
    capsule(ax, v, 2.35, -2.55, 2.2, -3.1),
    capsule(ax, v, 2.35, -2.55, 1.9, -2.85),
  );
  const cov = Math.max(
    aaCov(dThigh, 0.78),
    aaCov(dShin, 0.55),
    aaCov(dFoot, 0.36),
    aaCov(dToes, 0.18),
    aaCov(dUpper, 0.42),
    aaCov(dFore, 0.36),
    aaCov(dFingers, 0.15),
  );
  if (cov < 0.05) return;
  const dl = Math.min(dThigh, dShin, dFoot, dUpper, dFore);
  let sh = 0.3 + 0.16 * (1 - clamp01(dl / 0.7));
  if ((Math.floor((ax + v) * 0.95 + 20) & 1) === 0 && dl < 0.7) sh -= 0.09; // cross-bands
  if (Math.min(dToes, dFingers) < dl) sh = 0.42; // pale toe tips
  S.stamp(col, row, S.tileKey(pal, sh), cov, z + 0.1);
}

function startJump(e: Entity, rng: Rng, world: WorldView, mult: number): void {
  const d = e.data as FrogData;
  e.state = 'crouch';
  e.stateT = CROUCH;
  d.sx = e.x;
  d.sy = e.y;
  d.dist = range(rng, 80, 180) * mult;
  d.dur = range(rng, 0.35, 0.5);
  // Don't jump off the host: aim back inside if the landing spot would be outside.
  const m = 40;
  const lx = e.x + Math.cos(e.heading) * d.dist;
  const ly = e.y + Math.sin(e.heading) * d.dist;
  if (lx < m || ly < m || lx > world.w - m || ly > world.h - m) {
    const toC = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x);
    if (mult === 1) e.heading = toC + range(rng, -0.6, 0.6);
    else d.dist = Math.max(40, Math.min(d.dist, distToEdge(e, world, e.heading) - m));
  }
}

function distToEdge(e: Entity, world: WorldView, a: number): number {
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  const tx = cx > 0 ? (world.w - e.x) / cx : cx < 0 ? -e.x / cx : 1e9;
  const ty = cy > 0 ? (world.h - e.y) / cy : cy < 0 ? -e.y / cy : 1e9;
  return Math.min(tx, ty);
}

export const frog: AnimalDef = {
  id: 'frog',
  label: 'Frog',
  dot: '#34b553',
  baseCount: 16,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'soft',
  palettes: {
    skin: ['#04140a', '#0a2e16', '#145c2a', '#1f8a3c', '#34b553', '#6fd987', '#b8f2c6', '#f0fff4'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 60, Math.max(61, world.w - 60));
    e.y = range(rng, 60, Math.max(61, world.h - 60));
    e.heading = range(rng, 0, Math.PI * 2);
    e.scale = range(rng, 1.35, 1.75);
    e.seed = range(rng, 0, 1000);
    e.state = 'sit';
    e.stateT = range(rng, 0, 4);
    e.data = {
      baseScale: e.scale,
      blinkIn: range(rng, 2, 5),
      blink: 0,
      sx: e.x,
      sy: e.y,
      dist: 0,
      dur: 0.4,
      leg: 0,
    } satisfies FrogData;
    if (fromEdge) {
      placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
      startJump(e, rng, world, 1.5);
      (e.data as FrogData).dist = 200;
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as FrogData;
    const rng = world.rng;
    e.vx = 0; // frogs move only by jumping
    e.vy = 0;
    e.stateT -= dt;

    d.blinkIn -= dt;
    d.blink -= dt;
    if (d.blinkIn <= 0) {
      d.blink = 0.14;
      d.blinkIn = range(rng, 2, 5);
    }

    switch (e.state) {
      case 'sit':
        d.leg += (0 - d.leg) * approach(10, dt);
        if (e.stateT <= 0) {
          e.heading += range(rng, -Math.PI / 2, Math.PI / 2);
          startJump(e, rng, world, 1);
        }
        break;
      case 'crouch':
        d.leg += (-0.25 - d.leg) * approach(20, dt);
        if (e.stateT <= 0) {
          e.state = 'jump';
          e.stateT = d.dur;
        }
        break;
      case 'jump': {
        const t = clamp01(1 - e.stateT / d.dur);
        const p = t * t * (3 - 2 * t);
        e.x = Math.max(16, Math.min(world.w - 16, d.sx + Math.cos(e.heading) * d.dist * p));
        e.y = Math.max(16, Math.min(world.h - 16, d.sy + Math.sin(e.heading) * d.dist * p));
        e.scale = d.baseScale * (1 + 0.3 * Math.sin(Math.PI * t)); // closer to the viewer mid-air
        d.leg = Math.sin(Math.PI * Math.min(1, t * 1.3));
        if (e.stateT <= 0) {
          e.scale = d.baseScale;
          e.state = 'land';
          e.stateT = LAND;
        }
        break;
      }
      default: // land
        d.leg += (0 - d.leg) * approach(14, dt);
        if (e.stateT <= 0) {
          e.state = 'sit';
          e.stateT = range(rng, 1, 4);
        }
    }
    e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(12, dt);
  },

  onScatter(e, fx, fy) {
    // Jump straight away from the click, 1.5× as far.
    e.heading = Math.atan2(e.y - fy, e.x - fx);
    e.drawHeading = e.heading;
    const d = e.data as FrogData;
    if (e.state === 'jump') return;
    e.scale = d.baseScale;
    d.sx = e.x;
    d.sy = e.y;
    d.dist = 1.5 * (80 + 100 * ((e.seed * 7.31) % 1));
    d.dur = 0.42;
    e.state = 'jump';
    e.stateT = d.dur;
  },

  render(e, s) {
    S = s;
    cur = e;
    data = e.data as FrogData;
    pal = this.pal.skin;
    blotch = (e.seed % 97) * 1.37;
    // Legs fold in a Z while sitting; mid-air they stretch straight back.
    const l = Math.max(0, data.leg);
    const c = Math.min(0, data.leg); // crouch: tuck a little tighter
    kneeX = 3.3 + (2.3 - 3.3) * l;
    kneeY = 0.6 + (3.2 - 0.6) * l - c * 0.4;
    ankX = 2.7 + (1.9 - 2.7) * l;
    ankY = 3.4 + (5.7 - 3.4) * l + c * 0.6;
    toeX = 3.6 + (1.8 - 3.6) * l;
    toeY = 4.6 + (7.2 - 4.6) * l + c * 0.6;
    s.forEachCell(e, RADIUS, cellFn);
  },
};
