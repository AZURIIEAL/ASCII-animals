import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge, splatCapsule } from './common';
import { clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise, vnoise2 } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Octopus: a bulbous mantle, eyes with horizontal pupils, and eight tapering arms (with pale suckers)
// simulated as chains. It drifts with arms fanned out, then jets mantle-first with arms bunched behind.
// A click makes it flush dark, jet away and leave a spreading ink cloud.
const ARMS = 8;
const SEG = 10; // points per arm
const RADIUS = 5.6; // mantle + head, cells
const INK = 10; // ink puffs per octopus

interface OctoData {
  arms: Float32Array; // ARMS × SEG × (x, y), world px
  init: boolean;
  spread: number; // 0 bunched (jetting) … 1 fanned (drifting)
  ink: Float32Array; // INK × (x, y, age, size)
  inkN: number;
}

let S: Stamper;
let cur: Entity;
let palSkin = 0;
let palInk = 0;
let flush = 0;
let armK = 0;
let armJ = 0;

function bodyFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const em = ellipse(u, v, 0, -1.9, 2.15, 3.0, 0); // mantle (leads when jetting)
  const eh = ellipse(u, v, 0, 1.0, 1.85, 1.3, 0); // head
  const e = Math.min(em, eh);
  // Eyes on the sides of the head.
  const ex = Math.abs(u) - 1.35;
  const ey = v - 0.8;
  const de = ex * ex + ey * ey;
  if (de < 0.38) {
    const sh = (ex * ex) / 0.16 + (ey * ey) / 0.025 < 1 ? 0.02 : 0.88; // slit pupil in a pale eye
    S.stamp(col, row, S.tileKey(palSkin, sh), 1, z + 0.8);
    return;
  }
  if (e >= 1.12) return;
  let sh = 0.5 + 0.25 * (1 - clamp01(e));
  if (em < eh) sh += 0.12 * clamp01((-v - 1.9) / 3.0); // mantle tip catches light
  if (hash2(col * 5 + 1, row * 3 + cur.id) > 0.86) sh += 0.14; // papillae
  sh += (vnoise2(u * 1.3 + cur.seed, v * 1.3) - 0.5) * 0.16; // mottled skin
  sh -= 0.4 * smooth(0.72, 1.05, e) * sh;
  sh -= 0.25 * flush; // flushes dark when startled
  S.stamp(col, row, S.tileKey(palSkin, sh), softCov(e), z + 0.6);
}

function armKey(t: number, dn: number, col: number, row: number): number {
  const along = (armJ + t) / (SEG - 1);
  let sh = 0.46 + 0.2 * (1 - Math.abs(dn)) - 0.12 * along;
  // Suckers: pale dots along one edge of each arm.
  if (dn > 0.35 && ((armJ * 2 + Math.floor(t * 2)) & 1) === 0) sh = 0.82;
  sh += (hash2(col * 7, row * 11 + armK) - 0.5) * 0.08;
  sh -= 0.22 * flush;
  return S.tileKey(palSkin, sh);
}

function simArms(e: Entity, d: OctoData, world: WorldView, dt: number): void {
  const c = world.cell * e.scale;
  const fx = Math.cos(e.drawHeading);
  const fy = Math.sin(e.drawHeading);
  const rx = -fy;
  const ry = fx;
  const seg = 1.05 * c;
  const k = approach(9, dt);
  for (let a = 0; a < ARMS; a++) {
    const side = a - (ARMS - 1) / 2; // −3.5 … 3.5
    // Root on the rim of the head.
    const rootU = side * 0.4;
    const rootV = 1.95;
    let px = e.x + (rootU * rx - rootV * fx) * c;
    let py = e.y + (rootU * ry - rootV * fy) * c;
    const o = a * SEG * 2;
    if (!d.init) {
      for (let j = 0; j < SEG; j++) {
        d.arms[o + j * 2] = px - fx * seg * j;
        d.arms[o + j * 2 + 1] = py - fy * seg * j;
      }
    }
    d.arms[o] = px;
    d.arms[o + 1] = py;
    // Rest direction: straight back when bunched, fanned out radially when drifting; tips curl.
    const fan = side * (0.1 + 0.36 * d.spread);
    for (let j = 1; j < SEG; j++) {
      const curl = Math.sin(world.t * 1.4 + a * 1.7 + j * 0.55 + e.seed) * (0.15 + 0.5 * (j / SEG) * d.spread);
      const ang = Math.atan2(-fy, -fx) + fan + curl + side * 0.04 * j * d.spread;
      const tx = px + Math.cos(ang) * seg;
      const ty = py + Math.sin(ang) * seg;
      const i = o + j * 2;
      let x = d.arms[i] + (tx - d.arms[i]) * k;
      let y = d.arms[i + 1] + (ty - d.arms[i + 1]) * k;
      // Keep the link length.
      const dx = x - px;
      const dy = y - py;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      x = px + (dx / l) * seg;
      y = py + (dy / l) * seg;
      d.arms[i] = x;
      d.arms[i + 1] = y;
      px = x;
      py = y;
    }
  }
  d.init = true;
}

function renderInk(d: OctoData, z: number): void {
  const c = S.cell;
  for (let n = 0; n < d.inkN; n++) {
    const o = n * 4;
    const age = d.ink[o + 2];
    if (age <= 0 || age > 3) continue;
    const x = d.ink[o];
    const y = d.ink[o + 1];
    const R = d.ink[o + 3] * (0.5 + 0.7 * Math.sqrt(age)) * c;
    const fade = 1 - age / 3;
    const c0 = Math.floor((x - R) / c);
    const c1 = Math.floor((x + R) / c);
    const r0 = Math.floor((y - R) / c);
    const r1 = Math.floor((y + R) / c);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = (col + 0.5) * c - x;
        const dy = (row + 0.5) * c - y;
        const dist = Math.sqrt(dx * dx + dy * dy) / R + (vnoise2(col * 0.5 + n, row * 0.5) - 0.5) * 0.5;
        if (dist >= 1) continue;
        const a = fade * 0.85 * (1 - dist * dist);
        if (a < 0.05) continue;
        S.stamp(col, row, S.tileKey(palInk, 0.35 + 0.5 * (1 - dist)), a, z - 2);
      }
    }
  }
}

export const octopus: AnimalDef = {
  id: 'octopus',
  label: 'Octopus',
  dot: '#ea8a64',
  baseCount: 5,
  minCount: 2,
  maxCount: 10,
  radius: 12,
  clickMode: 'scatter',
  edge: 'soft',
  palettes: {
    skin: ['#140508', '#3a0d14', '#6b1a22', '#a12d2f', '#cf5640', '#ea8a64', '#f8c4a4'],
    // Smoky violet rather than true black, which would vanish on the dark background.
    ink: ['#0c0a12', '#1e1a2b', '#2f2942', '#433a5c', '#5e5280'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 120, Math.max(121, world.w - 120));
    e.y = range(rng, 120, Math.max(121, world.h - 120));
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 150, 210); // jet impulse, px/s
    e.rate = range(rng, 3, 5.5); // s between jets
    e.stateT = range(rng, 0, e.rate);
    e.state = 'drift';
    e.scale = range(rng, 0.85, 1.55) * world.size;
    e.seed = range(rng, 0, 1000);
    e.data = {
      arms: new Float32Array(ARMS * SEG * 2),
      init: false,
      spread: 1,
      ink: new Float32Array(INK * 4),
      inkN: 0,
    } satisfies OctoData;
    if (fromEdge) placeAtEdge(e, world, rng, 12 * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as OctoData;
    e.stateT -= dt;
    if (e.state === 'drift') {
      e.heading += (vnoise(world.t * 0.2 + e.seed) - 0.5) * 1.2 * dt;
      if (e.stateT <= 0) {
        e.state = 'jet';
        e.stateT = 0.45;
      }
    } else if (e.state === 'jet') {
      const a = (e.speed / 0.45) * (1 + e.panic);
      e.vx += Math.cos(e.heading) * a * dt;
      e.vy += Math.sin(e.heading) * a * dt;
      if (e.stateT <= 0) {
        e.state = 'drift';
        e.stateT = e.rate * (e.panic > 0.2 ? 0.4 : 1);
      }
    }
    const drag = Math.exp(-dt * 1.3);
    e.vx *= drag;
    e.vy *= drag;
    e.x += e.vx * dt;
    e.y += e.vy * dt + Math.sin(world.t * 0.9 + e.seed) * 4 * dt; // gentle bob
    const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    // Arms bunch while moving fast, fan out as it slows.
    d.spread += (clamp01(1 - sp / 120) - d.spread) * approach(e.state === 'jet' ? 8 : 1.5, dt);
    if (sp > 15) e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(3, dt);
    else e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(0.8, dt);
    simArms(e, d, world, dt);
    for (let n = 0; n < d.inkN; n++) {
      const o = n * 4;
      d.ink[o + 2] += dt;
      d.ink[o] += Math.sin(n * 2.3 + world.t * 0.5) * 6 * dt; // ink drifts
      d.ink[o + 1] += Math.cos(n * 1.7 + world.t * 0.4) * 6 * dt;
    }
  },

  onScatter(e) {
    const d = e.data as OctoData;
    e.state = 'jet';
    e.stateT = 0.5;
    // Ink: a cluster of puffs just behind the head.
    const c = 9 * e.scale;
    const bx = -Math.cos(e.heading);
    const by = -Math.sin(e.heading);
    d.inkN = INK;
    for (let n = 0; n < INK; n++) {
      const o = n * 4;
      const r = 1.5 + 2.5 * hash2(n, e.id);
      const a = hash2(n * 3, e.id + 7) * Math.PI * 2;
      d.ink[o] = e.x + bx * c * 2 + Math.cos(a) * r * c;
      d.ink[o + 1] = e.y + by * c * 2 + Math.sin(a) * r * c;
      d.ink[o + 2] = -0.04 * n; // staggered
      d.ink[o + 3] = 2.2 + 1.8 * hash2(n * 5, e.id + 3);
    }
  },

  render(e, s) {
    S = s;
    cur = e;
    palSkin = this.pal.skin;
    palInk = this.pal.ink;
    flush = clamp01(e.panic * 1.4);
    const d = e.data as OctoData;
    renderInk(d, e.z);
    const c = s.cell * e.scale;
    for (let a = 0; a < ARMS; a++) {
      armK = a;
      const o = a * SEG * 2;
      for (let j = 0; j < SEG - 1; j++) {
        armJ = j;
        const ra = (0.78 - 0.62 * (j / (SEG - 1))) * c;
        const rb = (0.78 - 0.62 * ((j + 1) / (SEG - 1))) * c;
        splatCapsule(s, d.arms[o + j * 2], d.arms[o + j * 2 + 1], d.arms[o + j * 2 + 2], d.arms[o + j * 2 + 3], ra, rb, e.z + 0.2, armKey);
      }
    }
    s.forEachCell(e, RADIUS, bodyFn);
  },
};
