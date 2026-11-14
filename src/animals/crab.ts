import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { capsule, clamp01, ellipse, G, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.7 / §9.7. Faces -v and scuttles sideways (±u) with an alternating gait; claws go up when startled.
const RADIUS = 6.2;
const GAIT_HZ = 6;

interface CrabData {
  dir: number; // +1 walks toward +u (right), -1 toward -u
  up: number; // claws-up amount 0..1, rendered
  facing: number; // slowly wandering body direction
}

let S: Stamper;
let cur: Entity;
let pal = 0;
let up = 0;
let gait = 0;
let walking = false;
const stalk = new Float32Array(4);

function legCov(d: number): number {
  return smooth(0.3 + 0.42, 0.3 - 0.08, d);
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);
  const side = u < 0 ? -1 : 1;

  // Shell.
  const eb = ellipse(u, v, 0, 0, 3.0, 2.0, 0);
  if (eb < 1.12) {
    const tx = u;
    const ty = v + 0.7;
    let sh = 0.3 + 0.42 * (1 - clamp01(Math.sqrt(tx * tx * 0.4 + ty * ty) / 2.2)); // lighter top centre
    sh -= 0.5 * smooth(0.68, 1.0, eb) * sh; // rim
    sh += (hash2(Math.floor(u * 1.6) + 3, Math.floor(v * 1.6) + cur.id * 41) - 0.5) * 0.2; // mottling
    const hx = u + 0.9;
    const hy = v + 0.9;
    if (hx * hx + hy * hy < 0.2) sh = 0.97; // highlight
    // Eyes: bright tiles at (±0.9, -2.4).
    S.stamp(col, row, S.tileKey(pal, sh), softCov(eb), z + 0.4);
    if (eb < 0.9) return;
  }
  const ex = ax - 0.9;
  const ey = v + 2.4 + 0.2 * up;
  if (ex * ex + ey * ey < 0.2) {
    S.stamp(col, row, S.tileKey(pal, 0.97), 1, z + 0.6);
    return;
  }

  // Claws: arm capsule and a pincer of two fingers with a notch; raised and opened when startled.
  const lift = -0.7 * up;
  const open = 0.35 + 0.45 * up;
  const pv = -3.3 + lift;
  const dArm = capsule(ax, v, 2.2, -1.2, 3.4, -2.6 + lift * 0.8);
  const f1 = ellipse(ax, v, 3.3, pv - 0.35, 0.42, 0.85, -open);
  const f2 = ellipse(ax, v, 3.95, pv - 0.1, 0.38, 0.75, open);
  const pinch = Math.min(f1, f2);
  const clawCov = Math.max(smooth(0.45 + 0.42, 0.45 - 0.08, dArm), softCov(pinch));
  if (clawCov > 0.05) {
    let sh = 0.48 + 0.25 * (1 - clamp01(pinch)) - 0.2 * smooth(0.75, 1.05, pinch);
    if (pinch < 1 && v < pv - 0.6) sh += 0.15; // lighter fingertips
    S.stamp(col, row, S.tileKey(pal, sh), clawCov, z + 0.3);
    if (clawCov > 0.6) return;
  }

  // Legs: 3 per side; tips lift (the leg shortens 20%) in an alternating gait.
  let best = 9;
  for (let k = 0; k < 3; k++) {
    const phase = gait + (k + (side > 0 ? 1 : 0)) * Math.PI;
    const l = walking ? Math.max(0, Math.sin(phase)) : 0;
    const rx = 2.6;
    const ry = -0.4 + 0.8 * k;
    const tx = rx + (4.4 - rx) * (1 - 0.2 * l);
    const ty = ry + (0.2 + 0.9 * k - ry) * (1 - 0.2 * l) + 0.25 * k;
    const dl = capsule(ax, v, rx, ry, tx, ty);
    if (dl < best) best = dl;
  }
  const lc = legCov(best);
  if (lc > 0.05) S.stamp(col, row, S.tileKey(pal, 0.38 + 0.1 * (1 - clamp01(best / 0.4))), lc, z + 0.1);
}

function nearEdge(e: Entity, world: WorldView, m: number): boolean {
  return e.x < m || e.y < m || e.x > world.w - m || e.y > world.h - m;
}

export const crab: AnimalDef = {
  id: 'crab',
  label: 'Crab',
  dot: '#e2463b',
  baseCount: 18,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'soft',
  palettes: {
    shell: ['#1a0303', '#420808', '#7f1212', '#b91c1c', '#e2463b', '#f7857a', '#ffd0c9'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 60, Math.max(61, world.w - 60));
    e.y = range(rng, 60, Math.max(61, world.h - 60));
    e.heading = range(rng, 0, Math.PI * 2); // body facing
    e.scale = range(rng, 1.05, 1.45);
    e.speed = range(rng, 40, 80);
    e.seed = range(rng, 0, 1000);
    e.phase = range(rng, 0, 10);
    e.state = rng() < 0.5 ? 'walk' : 'pause';
    e.stateT = range(rng, 0.3, 2);
    e.data = { dir: rng() < 0.5 ? -1 : 1, up: 0, facing: e.heading } satisfies CrabData;
    if (fromEdge) {
      placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
      // placeAtEdge aims the heading inward; crabs walk sideways, so face 90° off it.
      e.heading -= Math.PI / 2;
      (e.data as CrabData).dir = 1;
      e.state = 'walk';
      e.stateT = 1.5;
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as CrabData;
    const rng = world.rng;
    e.stateT -= dt;
    let speed = 0;
    switch (e.state) {
      case 'walk':
        speed = e.speed;
        if (e.stateT <= 0) {
          e.state = 'pause';
          e.stateT = range(rng, 0.3, 1.5);
        }
        break;
      case 'pause':
        if (e.stateT <= 0) {
          e.state = 'walk';
          e.stateT = range(rng, 0.5, 2);
          e.heading += range(rng, -0.6, 0.6);
          d.dir = rng() < 0.5 ? -1 : 1;
          if (nearEdge(e, world, 90)) {
            // Turn so that walking (sideways) heads back toward the middle.
            e.heading = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x) - Math.PI / 2 + range(rng, -0.5, 0.5);
            d.dir = 1;
          }
        }
        break;
      case 'claws':
        if (e.stateT <= 0) {
          e.state = 'run';
          e.stateT = range(rng, 0.8, 1.2);
        }
        break;
      default: // run
        speed = e.speed * 3;
        if (e.stateT <= 0) {
          e.state = 'pause';
          e.stateT = range(rng, 0.4, 1.0);
        }
    }
    d.up += ((e.state === 'claws' || e.state === 'run' ? 1 : 0) - d.up) * approach(12, dt);
    // Walk sideways: along the body's right vector (u axis).
    const rx = -Math.sin(e.drawHeading) * d.dir;
    const ry = Math.cos(e.drawHeading) * d.dir;
    e.vx = rx * speed;
    e.vy = ry * speed;
    e.x = Math.max(10, Math.min(world.w - 10, e.x + e.vx * dt));
    e.y = Math.max(10, Math.min(world.h - 10, e.y + e.vy * dt));
    if (speed > 0) e.phase += dt * GAIT_HZ * Math.PI * 2 * (speed / e.speed);
    e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(5, dt);
  },

  onScatter(e, fx, fy) {
    // Claws up for 0.4 s, then run straight away at 3× speed (sideways, so face 90° off the flee line).
    const d = e.data as CrabData;
    const away = Math.atan2(e.y - fy, e.x - fx);
    e.heading = away - Math.PI / 2;
    e.drawHeading = e.heading;
    d.dir = 1;
    e.state = 'claws';
    e.stateT = 0.4;
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.shell;
    const d = e.data as CrabData;
    up = d.up;
    gait = e.phase;
    walking = e.state === 'walk' || e.state === 'run';
    s.forEachCell(e, RADIUS, cellFn);
    // Eye stalks: glyph-only '|'.
    for (let side = -1; side <= 1; side += 2) {
      stalk[0] = side * 0.85;
      stalk[1] = -1.7;
      stalk[2] = side * 0.9;
      stalk[3] = -2.05 - 0.2 * up;
      s.stampLine(e, stalk, 2, pal, 0.6, e.z + 0.5, G['|']);
    }
  },
};
