import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { capsule, clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { hash2, range, type Rng } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.5 / §9.5. Sit → crouch → jump → land, with legs that stretch back while airborne.
const RADIUS = 7.6;
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
let shinX = 3.0;
let shinY = 3.4;

function legCov(d: number, r: number): number {
  return smooth(r + 0.45, r - 0.1, d);
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // Body and head.
  const eb = ellipse(u, v, 0, 0.4, 2.4, 2.9, 0);
  const eh = ellipse(u, v, 0, -2.2, 2.0, 1.5, 0);
  const e = Math.min(eb, eh);
  // Eyes bulge out of the head.
  const ex = ax - 1.3;
  const ey = v + 2.9;
  const dEye = Math.sqrt(ex * ex + ey * ey);
  const eyeCov = smooth(0.75 + 0.35, 0.75 - 0.15, dEye);

  if (eyeCov > 0.05) {
    let sh = 0.97;
    const px = ax - 1.4;
    const py = v + 3.0;
    if (data.blink > 0) sh = 0.45;
    else if (px * px + py * py < 0.12) sh = 0.02; // pupil
    S.stamp(col, row, S.tileKey(pal, sh), Math.max(eyeCov, 0.9 * softCov(e)), z + 0.6);
    if (eyeCov > 0.6) return;
  }

  if (e < 1.12) {
    let sh = 0.42 + 0.18 * clamp01(-(v - 0.4) / 2.9); // a touch lighter toward the head
    sh += 0.18 * smooth(0.7, 0.0, ax); // pale stripe down the back
    sh -= 0.2 * clamp01(ax / 2.4); // darker sides
    sh -= 0.45 * smooth(0.7, 1.0, e) * sh; // rim
    const n = hash2(Math.floor(u * 1.1) + 11, Math.floor(v * 1.1) + cur.id * 19);
    if (n > 0.8 && ax > 0.6) sh -= 0.2; // spots
    sh += (hash2(Math.floor(u * 1.8), Math.floor(v * 1.8) + cur.id * 3) - 0.5) * 0.12; // mottling
    const hx = u + 0.6;
    const hy = v + 2.5;
    if (hx * hx + hy * hy < 0.25) sh = 0.95; // highlight on the head
    S.stamp(col, row, S.tileKey(pal, sh), softCov(e), z + 0.4);
    if (e < 0.9) return;
  }

  // Legs (tiles, a little darker than the body).
  const dThigh = capsule(ax, v, 1.8, 1.6, 3.4, 0.8);
  const dShin = capsule(ax, v, 3.4, 0.8, shinX, shinY);
  const fe = ellipse(ax, v, shinX + 0.3, shinY + 0.5, 0.75, 0.5, 0.3 - data.leg * 0.6);
  const dFront = capsule(ax, v, 1.7, -1.2, 2.9, -2.2);
  const cov = Math.max(legCov(dThigh, 0.75), legCov(dShin, 0.5), softCov(fe), legCov(dFront, 0.42));
  if (cov < 0.05) return;
  let sh = 0.34 + 0.15 * (1 - clamp01(Math.min(dThigh, dShin, dFront) / 0.7));
  sh += (hash2(Math.floor(u * 2) + 5, Math.floor(v * 2) + cur.id) - 0.5) * 0.1;
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
    e.scale = range(rng, 1.15, 1.6);
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
    // Shin end blends toward (1.6, 6.5) while airborne: the legs stretch back.
    const l = data.leg;
    shinX = 3.0 + (1.6 - 3.0) * Math.max(0, l);
    shinY = 3.4 + (6.5 - 3.4) * Math.max(0, l) + Math.min(0, l) * 1.2;
    s.forEachCell(e, RADIUS, cellFn);
  },
};
