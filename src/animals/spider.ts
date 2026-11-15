import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { clamp01, ellipse, G, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Spider (a garden spider): banded cephalothorax, a big abdomen with a dark folium (leaf pattern) and
// pale paired spots, tiny bright eyes, and eight jointed legs in an alternating tetrapod gait. Some walk
// in quick dashes; others hang head-down on a silk thread from the top edge, lowering and climbing.
// A click: walkers bolt, hangers race back up their thread.
const RADIUS = 3.8; // body only; legs are glyph lines
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
  // Eyes: a tight cluster of glossy dots at the front of the carapace.
  if ((ax < 0.3 && Math.abs(v + 2.0) < 0.2) || (Math.abs(ax - 0.45) < 0.16 && Math.abs(v + 1.8) < 0.18)) {
    S.stamp(col, row, S.tileKey(palMark, 0.95), 0.95, z + 0.9);
    return;
  }
  const ec = ellipse(u, v, 0, -1.0, 0.95, 1.12, 0); // cephalothorax
  const ea = ellipse(u, v, 0, 1.75, 1.45, 1.85, 0); // abdomen
  const e = Math.min(ec, ea);
  if (e >= 1.12) return;
  let p = pal;
  let sh: number;
  if (ea <= ec) {
    // Abdomen: a dark scalloped leaf (folium) down the back edged in pale, pale paired spots, and a
    // light shoulder hump at the front.
    sh = 0.5 + 0.18 * (1 - clamp01(ea));
    const lv = (v - 1.75) / 1.85; // −1 front … 1 back
    const leaf = 0.75 * (1 - lv * lv) * (0.85 + 0.15 * Math.cos(lv * 9)); // wavy edge
    if (ax < leaf - 0.14) sh -= 0.24;
    else if (ax < leaf + 0.12) sh += 0.1;
    for (let i = 0; i < 3; i++) {
      const sx = ax - (0.32 - 0.06 * i);
      const sy = v - (1.15 + 0.6 * i);
      if (sx * sx + sy * sy < 0.035) {
        p = palMark;
        sh = 0.92;
      }
    }
    if (lv < -0.6 && ax > 0.5 && ax < 1.0) {
      p = palMark;
      sh = 0.55; // shoulder humps
    }
  } else {
    // Carapace: a pale median band and dark radial grooves.
    sh = 0.48 + 0.18 * (1 - clamp01(ec));
    if (ax < 0.22) {
      p = palMark;
      sh = 0.5;
    } else if (Math.abs(ax - 0.62) < 0.13) sh -= 0.16;
  }
  sh += (hash2(col * 3 + 1, row * 7 + cur.id) - 0.5) * 0.08; // hairs
  sh -= 0.35 * smooth(0.75, 1.05, e) * sh;
  S.stamp(col, row, S.tileKey(p, sh), softCov(e, 0.85, 1.12), z + 0.5);
}

/** Legs and pedipalps as glyph lines: long, thin, jointed, with pale bands at the knees. */
const L = new Float32Array(2 * 48);
let K = 1;
function seg(n0: number, ax: number, ay: number, bx: number, by: number): number {
  const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) * K) + (n0 ? 0 : 1));
  for (let i = 0; i < n; i++) {
    const t = (i + (n0 ? 1 : 0)) / (n - (n0 ? 0 : 1));
    L[(n0 + i) * 2] = ax + (bx - ax) * t;
    L[(n0 + i) * 2 + 1] = ay + (by - ay) * t;
  }
  return n0 + n;
}

function limbs(e: Entity, s: Stamper): void {
  K = e.scale;
  const z = e.z + 0.2;
  for (let side = 0; side < 2; side++) {
    const sg = side ? 1 : -1;
    for (let k = 0; k < LEGS; k++) {
      const o = (side * LEGS + k) * 6;
      let n = seg(0, sg * J[o], J[o + 1], sg * J[o + 2], J[o + 3]);
      s.stampLine(e, L, n, pal, 0.95, z, G['o']);
      n = seg(0, sg * J[o + 2], J[o + 3], sg * J[o + 4], J[o + 5]);
      s.stampLine(e, L, n, pal, 1, z, G["'"]);
    }
    // Pedipalps: two short feelers beside the fangs.
    const n = seg(0, sg * 0.35, -2.05, sg * 0.55, -2.75);
    s.stampLine(e, L, n, pal, 0.8, z, G['.']);
  }
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
  radius: 7.4,
  clickMode: 'scatter',
  edge: 'none',
  palettes: {
    body: ['#080605', '#1b1410', '#33261c', '#4e3b2b', '#6e553f', '#927458', '#bb9a79'],
    mark: ['#2a1d10', '#6e5232', '#b89464', '#e8cfa0', '#fff6e2'],
    silk: ['#1c1f26', '#dfe5ee'],
  },
  lineShade: { silk: 1, body: 1 },
  pal: {},

  spawn(world, rng) {
    const e = world.newEntity();
    const hang = rng() < 0.4;
    const d: SpiderData = { hang, anchorX: 0, targetY: 0, mode: 0 };
    e.data = d;
    e.scale = range(rng, 1.7, 2.8) * world.size;
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
      const end = Math.floor((e.y - 3.5 * e.scale * c) / c);
      const key = s.lineKey(this.pal.silk, G['|']);
      for (let row = 0; row <= end; row++) s.stamp(col, row, key, 0.4, e.z - 1);
    }
    s.forEachCell(e, RADIUS, cellFn);
    limbs(e, s);
  },
};
