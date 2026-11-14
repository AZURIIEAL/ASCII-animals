import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { aaCov, capsule, clamp01, ellipse, G, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spider (a garden spider): banded cephalothorax, a big abdomen with a dark folium (leaf pattern) and
// pale paired spots, tiny bright eyes, and eight jointed legs in an alternating tetrapod gait. Some walk
// in quick dashes; others hang head-down on a silk thread from the top edge, lowering and climbing.
// A click: walkers bolt, hangers race back up their thread.
const RADIUS = 7.4;
const LEGS = 4; // per side
const ANG = [-1.05, -0.4, 0.3, 0.95]; // leg directions from +u (negative = toward the head)
const BEND = [-0.5, -0.25, 0.3, 0.55]; // knee bend: front legs reach forward, back legs back
const FEMUR = [2.5, 2.15, 1.9, 2.3];
const TIBIA = [2.9, 2.35, 2.05, 2.7];

interface SpiderData {
  hang: boolean;
  anchorX: number; // thread x
  targetY: number; // how far down to go
  mode: number; // hang: 0 descend, 1 pause, 2 climb, 3 wait out of view · walk: 0 dash, 1 pause
}

let S: Stamper;
let cur: Entity;
let pal = 0;
let palMark = 0;
let gait = 0;
let tuck = 1; // legs pulled in a little while hanging
const J = new Float32Array(2 * LEGS * 6); // per side and leg: root, knee, tip (u, v)

function setLegs(walking: boolean): void {
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < LEGS; k++) {
      // Alternating tetrapod: L0 L2 R1 R3 swing together.
      const ph = gait + ((k + s) & 1) * Math.PI;
      const sw = walking ? Math.sin(ph) * 0.22 : Math.sin(gait * 0.3 + k) * 0.04;
      const a = ANG[k] + sw;
      const o = (s * LEGS + k) * 6;
      const rx = 0.55;
      const ry = -1.45 + 0.32 * k;
      const kx = rx + Math.cos(a) * FEMUR[k] * tuck;
      const ky = ry + Math.sin(a) * FEMUR[k] * tuck;
      const b = a + BEND[k];
      J[o] = rx;
      J[o + 1] = ry;
      J[o + 2] = kx;
      J[o + 3] = ky;
      J[o + 4] = kx + Math.cos(b) * TIBIA[k] * tuck;
      J[o + 5] = ky + Math.sin(b) * TIBIA[k] * tuck;
    }
  }
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);
  // Eyes: a few bright dots at the front.
  if ((ax < 0.32 && Math.abs(v + 2.05) < 0.22) || (Math.abs(ax - 0.42) < 0.18 && Math.abs(v + 1.85) < 0.2)) {
    S.stamp(col, row, S.tileKey(palMark, 0.95), 0.9, z + 0.9);
    return;
  }
  const ec = ellipse(u, v, 0, -1.0, 0.98, 1.15, 0);
  const ea = ellipse(u, v, 0, 1.6, 1.4, 1.75, 0);
  const e = Math.min(ec, ea);
  if (e < 1.12) {
    let p = pal;
    let sh: number;
    if (ea <= ec) {
      sh = 0.56 + 0.22 * (1 - clamp01(ea));
      // Folium: a dark leaf down the middle, with pale paired spots either side.
      const lv = (v - 1.6) / 1.75;
      if (ax < 0.62 * (1 - lv * lv)) sh -= 0.2;
      for (let i = 0; i < 3; i++) {
        const sx = ax - (0.55 - 0.08 * i);
        const sy = v - (0.95 + 0.62 * i);
        if (sx * sx + sy * sy < 0.07) {
          p = palMark;
          sh = 0.8;
        }
      }
      if (ax < 0.12 && v > 0.5 && v < 2.8 && ((Math.floor(v * 2) & 1) === 0)) {
        p = palMark;
        sh = 0.7; // pale cross-line
      }
    } else {
      sh = 0.52 + 0.2 * (1 - clamp01(ec));
      if (Math.abs(ax - 0.5) < 0.16) sh -= 0.14; // dark bands either side of the carapace
    }
    sh += (hash2(col * 3 + 1, row * 7 + cur.id) - 0.5) * 0.08; // hairs
    sh -= 0.35 * Math.max(0, Math.min(1, (e - 0.75) / 0.3)) * sh;
    S.stamp(col, row, S.tileKey(p, sh), softCov(e), z + 0.5);
    if (e < 0.9) return;
  }
  // Legs: thin tiles, banded at the joints.
  const s = u < 0 ? 0 : 1;
  let best = 9;
  let knee = 9;
  for (let k = 0; k < LEGS; k++) {
    const o = (s * LEGS + k) * 6;
    const d1 = capsule(ax, v, J[o], J[o + 1], J[o + 2], J[o + 3]);
    const d2 = capsule(ax, v, J[o + 2], J[o + 3], J[o + 4], J[o + 5]);
    if (d1 < best) best = d1;
    if (d2 < best) best = d2;
    const kx = ax - J[o + 2];
    const ky = v - J[o + 3];
    knee = Math.min(knee, kx * kx + ky * ky);
  }
  const lc = aaCov(best, 0.2);
  if (lc > 0.34) S.stamp(col, row, S.tileKey(knee < 0.3 ? palMark : pal, knee < 0.3 ? 0.62 : 0.62), lc, z + 0.2);
}

function chooseHang(e: Entity, d: SpiderData, world: WorldView): void {
  const r = world.rng;
  d.anchorX = range(r, 40, Math.max(41, world.w - 40));
  d.targetY = range(r, world.h * 0.18, world.h * 0.55);
  e.x = d.anchorX;
}

export const spider: AnimalDef = {
  id: 'spider',
  label: 'Spider',
  dot: '#c27a2a',
  baseCount: 8,
  maxCount: 16,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'none',
  palettes: {
    body: ['#060506', '#151215', '#28222a', '#3d3440', '#574b5c', '#7a6c80', '#b0a3b5'],
    mark: ['#2a1606', '#6b3a0f', '#c27a2a', '#f0b562', '#fff1d6'],
    silk: ['#1c1f26', '#dfe5ee'],
  },
  lineShade: { silk: 1 },
  pal: {},

  spawn(world, rng) {
    const e = world.newEntity();
    const hang = rng() < 0.4;
    const d: SpiderData = { hang, anchorX: 0, targetY: 0, mode: 0 };
    e.data = d;
    e.scale = range(rng, 1.35, 1.7);
    e.seed = range(rng, 0, 1000);
    e.speed = range(rng, 70, 115);
    e.phase = range(rng, 0, 10);
    if (hang) {
      chooseHang(e, d, world);
      e.y = range(rng, 20, d.targetY);
      e.heading = Math.PI / 2; // head down
      d.mode = rng() < 0.5 ? 0 : 1;
      e.stateT = range(rng, 1, 4);
    } else {
      e.x = range(rng, 80, Math.max(81, world.w - 80));
      e.y = range(rng, 80, Math.max(81, world.h - 80));
      e.heading = range(rng, 0, Math.PI * 2);
      d.mode = 1;
      e.stateT = range(rng, 0.2, 1.5);
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as SpiderData;
    const r = world.rng;
    e.stateT -= dt;
    if (d.hang) {
      e.heading = Math.PI / 2;
      const climbFast = e.panic > 0.05;
      if (climbFast && d.mode !== 3) d.mode = 2;
      if (d.mode === 0) {
        e.y += 26 * dt;
        if (e.y >= d.targetY) {
          d.mode = 1;
          e.stateT = range(r, 2, 5);
        }
      } else if (d.mode === 1) {
        if (e.stateT <= 0) d.mode = 2;
      } else if (d.mode === 2) {
        e.y -= (climbFast ? 190 : 32) * dt;
        if (e.y < -RADIUS * e.scale * world.cell) {
          d.mode = 3;
          e.stateT = range(r, 2.5, 6);
        }
      } else if (e.stateT <= 0 && e.panic < 0.05) {
        chooseHang(e, d, world);
        d.mode = 0;
      }
      e.x = d.anchorX + Math.sin(world.t * 0.9 + e.seed) * 4; // sway on the thread
      e.vx = 0;
      e.vy = 0;
      e.phase += dt * 0.6;
    } else {
      // Dash, pause, turn.
      if (d.mode === 0) {
        const sp = e.speed * (1 + 1.6 * e.panic);
        e.vx = Math.cos(e.heading) * sp;
        e.vy = Math.sin(e.heading) * sp;
        e.phase += dt * sp * 0.09;
        if (e.stateT <= 0 && e.panic < 0.1) {
          d.mode = 1;
          e.stateT = range(r, 0.4, 1.8);
        }
      } else {
        e.vx = 0;
        e.vy = 0;
        if (e.stateT <= 0) {
          d.mode = 0;
          e.stateT = range(r, 0.3, 1.0);
          e.heading += range(r, -1.4, 1.4);
          const m = 110;
          if (e.x < m || e.y < m || e.x > world.w - m || e.y > world.h - m) {
            e.heading = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x) + range(r, -0.5, 0.5);
          }
        }
      }
      e.x = Math.max(15, Math.min(world.w - 15, e.x + e.vx * dt));
      e.y = Math.max(15, Math.min(world.h - 15, e.y + e.vy * dt));
    }
    e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(14, dt);
  },

  onScatter(e) {
    const d = e.data as SpiderData;
    if (!d.hang) {
      d.mode = 0;
      e.stateT = 0.6;
    }
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.body;
    palMark = this.pal.mark;
    const d = e.data as SpiderData;
    gait = e.phase;
    tuck = d.hang ? 0.85 : 1;
    setLegs(!d.hang && d.mode === 0);
    // Silk thread from the top edge down to the spinnerets.
    if (d.hang) {
      const c = s.cell;
      const col = Math.floor(e.x / c);
      const end = Math.floor((e.y - 3.3 * e.scale * c) / c);
      const key = s.lineKey(this.pal.silk, G['|']);
      for (let row = 0; row <= end; row++) s.stamp(col, row, key, 0.4, e.z - 1);
    }
    s.forEachCell(e, RADIUS, cellFn);
  },
};
