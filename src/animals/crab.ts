import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { aaCov, capsule, clamp01, ellipse, smooth, softCov } from '../engine/shapes';
import { vnoise2 } from '../math/noise';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.7 / §9.7, reworked to read as a real shore crab: a wide shell with front teeth, a groove and
// pale speckles; eyes as dark beads on short stalks; big claws folded in front (dark fingertips) that
// swing up and open when startled; four jointed walking legs per side that step in a gait.
// Faces -v and scuttles sideways (±u).
const RADIUS = 7.6;
const GAIT_HZ = 6;
const LEGS = 4;

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
// Claw joints (right side; mirrored), set per crab from `up`.
let wristX = 0;
let wristY = 0;
let palmX = 0;
let palmY = 0;
let palmRot = 0;
let tipX = 0; // fixed finger tip
let tipY = 0;
let dacX = 0; // movable finger tip
let dacY = 0;
// Leg joints per side: [rootX, rootY, kneeX, kneeY, tipX, tipY] × LEGS, for the right (+) and left (−) side.
const legR = new Float32Array(LEGS * 6);
const legL = new Float32Array(LEGS * 6);

function legs(side: number, out: Float32Array): void {
  for (let k = 0; k < LEGS; k++) {
    // Fanned around the shell: front pair angled forward, back pair angled back.
    const ph = gait + (k + (side > 0 ? 0 : 1)) * Math.PI; // alternating gait
    const lift = walking ? Math.max(0, Math.sin(ph)) : 0;
    const swing = walking ? Math.cos(ph) * 0.18 : 0;
    const a = -0.3 + 0.4 * k + swing;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx = 2.9 * ca;
    const ry = 0.1 + 2.0 * sa;
    const reach = 2.15 - 0.35 * lift;
    const kx = rx + reach * ca;
    const ky = ry + reach * sa - 0.25;
    const b = a + 0.95; // bent back at the knee
    const len = 1.7 * (1 - 0.3 * lift); // a lifted tip looks shorter from above
    out[k * 6] = rx;
    out[k * 6 + 1] = ry;
    out[k * 6 + 2] = kx;
    out[k * 6 + 3] = ky;
    out[k * 6 + 4] = kx + len * Math.cos(b);
    out[k * 6 + 5] = ky + len * Math.sin(b);
  }
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);
  const side = u < 0 ? -1 : 1;

  // ---- eyes: dark beads on short stalks ----
  const dStalk = capsule(ax, v, 0.75, -1.85, 0.9, -2.55 - 0.25 * up);
  const ex = ax - 0.92;
  const ey = v + 2.75 + 0.3 * up;
  const dEye = Math.sqrt(ex * ex + ey * ey);
  if (dEye < 0.9) {
    // A bright bead (dark eyes vanish on the dark background).
    S.stamp(col, row, S.tileKey(pal, 0.97), aaCov(dEye, 0.3), z + 0.7);
    if (dEye < 0.35) return;
  }
  if (dStalk < 0.5) S.stamp(col, row, S.tileKey(pal, 0.55), aaCov(dStalk, 0.16), z + 0.65);

  // ---- shell: wide, flatter in front, with small teeth along the front corners ----
  const sv = v < 0 ? v / 0.86 : v;
  let es = ellipse(u, sv, 0, 0.1, 3.25, 2.3, 0);
  const ang = Math.atan2(v - 0.1, ax);
  if (ang < -0.2 && ang > -1.25) es -= 0.045 * Math.max(0, Math.sin(ang * 16)); // anterolateral teeth
  if (es < 1.12) {
    const cx = u;
    const cy = v + 0.4;
    let sh = 0.46 + 0.32 * (1 - clamp01(Math.sqrt(cx * cx * 0.35 + cy * cy) / 2.1)); // domed: lighter centre
    if (ax < 0.16 && v > -0.6 && v < 1.4) sh -= 0.12; // central groove
    if (Math.abs(v - 0.15 - 0.25 * ax) < 0.13 && ax > 0.4 && ax < 1.6) sh -= 0.1; // cervical groove
    if (v < -1.55 && ax < 0.55) sh -= 0.12; // notch between the eyes
    if (hash2(Math.floor(u * 1.7) + 5, Math.floor(v * 1.7) + cur.id * 41) > 0.9 && es < 0.8) sh += 0.16; // speckles
    sh -= 0.4 * smooth(0.72, 1.02, es) * sh; // rim
    sh += (vnoise2(u * 0.9 + cur.seed, v * 0.9) - 0.5) * 0.12;
    S.stamp(col, row, S.tileKey(pal, sh), softCov(es), z + 0.4);
    if (es < 0.88) return;
  }

  // ---- claws: arm → wrist → palm, with a fixed finger and a movable finger (front only) ----
  if (v < -0.6) {
    const dArm = capsule(ax, v, 2.3, -1.25, wristX, wristY);
    const dWrist = capsule(ax, v, wristX, wristY, palmX, palmY);
    const ep = ellipse(ax, v, palmX, palmY, 1.1, 0.8, palmRot);
    const dFix = capsule(ax, v, palmX - 0.55 * Math.cos(palmRot), palmY - 0.55 * Math.sin(palmRot), tipX, tipY);
    const dDac = capsule(ax, v, palmX - 0.35 * Math.cos(palmRot) - 0.35 * Math.sin(palmRot), palmY - 0.35 * Math.sin(palmRot) + 0.35 * Math.cos(palmRot) * -1, dacX, dacY);
    const cArm = Math.max(aaCov(dArm, 0.42), aaCov(dWrist, 0.48));
    const cPalm = softCov(ep);
    const cFing = Math.max(aaCov(dFix, 0.26), aaCov(dDac, 0.22));
    const cc = Math.max(cArm, cPalm, cFing);
    if (cc > 0.05) {
      let sh: number;
      if (cFing > cPalm && cFing > cArm) {
        const tip = Math.min(
          (ax - tipX) * (ax - tipX) + (v - tipY) * (v - tipY),
          (ax - dacX) * (ax - dacX) + (v - dacY) * (v - dacY),
        );
        sh = tip < 0.35 ? 0.16 : 0.62; // dark fingertips
      } else if (cPalm >= cArm) {
        sh = 0.6 + 0.25 * (1 - clamp01(ep)) - 0.22 * smooth(0.7, 1.0, ep);
      } else {
        sh = 0.52 + 0.12 * (1 - clamp01(Math.min(dArm, dWrist) / 0.45));
      }
      sh += (hash2(Math.floor(u * 2) + 9, Math.floor(v * 2) + cur.id) - 0.5) * 0.08;
      S.stamp(col, row, S.tileKey(pal, sh), cc, z + 0.45);
      if (cc > 0.6) return;
    }
  }

  // ---- walking legs: two segments each, bent back at the knee (at the sides only) ----
  if (ax < 2.2) return;
  const L = side > 0 ? legR : legL;
  let best = 9;
  let seg2 = false;
  for (let k = 0; k < LEGS; k++) {
    const o = k * 6;
    const d1 = capsule(ax, v, L[o], L[o + 1], L[o + 2], L[o + 3]);
    const d2 = capsule(ax, v, L[o + 2], L[o + 3], L[o + 4], L[o + 5]);
    if (d1 < best) {
      best = d1;
      seg2 = false;
    }
    if (d2 < best) {
      best = d2;
      seg2 = true;
    }
  }
  const lc = aaCov(best, seg2 ? 0.28 : 0.36);
  // Skip the faintest fringe: thin legs read crisp instead of furry.
  if (lc > 0.32) S.stamp(col, row, S.tileKey(pal, seg2 ? 0.48 : 0.56), lc, z + 0.1);
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
    e.scale = range(rng, 1.0, 1.75) * world.size;
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
    // Claws folded in front, pointing inward; startled, they swing up and out and open.
    wristX = 3.35 + 0.3 * up;
    wristY = -2.35 - 0.6 * up;
    palmX = 2.35 + 1.0 * up;
    palmY = -3.5 - 1.0 * up;
    palmRot = 0.55 - 1.2 * up;
    const open = 0.25 + 0.55 * up;
    tipX = palmX - 1.45 * Math.cos(palmRot);
    tipY = palmY - 1.45 * Math.sin(palmRot);
    dacX = palmX - 1.35 * Math.cos(palmRot - open) - 0.2;
    dacY = palmY - 1.35 * Math.sin(palmRot - open) + 0.15;
    legs(1, legR);
    legs(-1, legL);
    s.forEachCell(e, RADIUS, cellFn);
  },
};
