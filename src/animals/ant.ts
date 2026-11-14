import type { AnimalDef, Entity, Pellet, Stamper, WorldView } from './types';
import { aaCov, capsule, clamp01, ellipse, softCov } from '../engine/shapes';
import { range, type Rng } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Ants: small three-part bodies (head, thorax, glossy gaster) with glyph-only jointed legs in a tripod
// gait and elbowed antennae. They march in two-way columns along winding trails; a click drops a
// crumb, and the nearest ants leave the trail, pick it up and carry it home.
const RADIUS = 4.2;
const CRUMB_LIFE = 40; // s
const FETCHERS = 3;

interface Path {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number; // unit normal
  ny: number;
  len: number;
  a1: number;
  k1: number;
  p1: number;
  a2: number;
  k2: number;
  p2: number;
}

interface AntData {
  path: number;
  p: number; // 0..1 along the path
  dir: number; // ±1
  lane: number; // px offset from the trail centre line
  mode: 0 | 1 | 2; // 0 trail, 1 fetch, 2 return
  target: Pellet | null;
  carry: boolean;
}

// Trails are per world (host size); rebuilt when the size changes.
const trails = new WeakMap<WorldView, { w: number; h: number; paths: Path[] }>();

function makePaths(world: WorldView, rng: Rng): Path[] {
  const n = world.w * world.h > 1.2e6 ? 3 : 2;
  const out: Path[] = [];
  for (let i = 0; i < n; i++) {
    // Each trail crosses the host between two opposite-ish edges.
    const horiz = i % 2 === 0;
    const m = 60;
    const t0 = range(rng, 0.15, 0.85);
    const t1 = Math.min(0.9, Math.max(0.1, t0 + range(rng, -0.35, 0.35)));
    const ax = horiz ? -m : world.w * t0;
    const ay = horiz ? world.h * t0 : -m;
    const bx = horiz ? world.w + m : world.w * t1;
    const by = horiz ? world.h * t1 : world.h + m;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    out.push({
      ax,
      ay,
      bx,
      by,
      nx: -dy / len,
      ny: dx / len,
      len,
      a1: range(rng, 40, 90),
      k1: range(rng, 4, 7),
      p1: range(rng, 0, 6),
      a2: range(rng, 10, 25),
      k2: range(rng, 11, 17),
      p2: range(rng, 0, 6),
    });
  }
  return out;
}

function pathsFor(world: WorldView): Path[] {
  let t = trails.get(world);
  if (!t || t.w !== world.w || t.h !== world.h) {
    t = { w: world.w, h: world.h, paths: makePaths(world, world.rng) };
    trails.set(world, t);
  }
  return t.paths;
}

const PT = { x: 0, y: 0, tx: 0, ty: 0 };
/** Point and unit tangent on path at p. */
function pathAt(P: Path, p: number): void {
  const off = P.a1 * Math.sin(p * P.k1 + P.p1) + P.a2 * Math.sin(p * P.k2 + P.p2);
  const dOff = (P.a1 * P.k1 * Math.cos(p * P.k1 + P.p1) + P.a2 * P.k2 * Math.cos(p * P.k2 + P.p2)) / P.len;
  const ux = (P.bx - P.ax) / P.len;
  const uy = (P.by - P.ay) / P.len;
  PT.x = P.ax + (P.bx - P.ax) * p + P.nx * off;
  PT.y = P.ay + (P.by - P.ay) * p + P.ny * off;
  const tx = ux + P.nx * dOff;
  const ty = uy + P.ny * dOff;
  const l = Math.sqrt(tx * tx + ty * ty);
  PT.tx = tx / l;
  PT.ty = ty / l;
}

// ---- rendering ----
let S: Stamper;
let cur: Entity;
let pal = 0;
let palCrumb = 0;
let gait = 0;
let carrying = false;
const LEG_ROOT_V = [-1.0, -0.75, -0.5];
const LEG_KNEE = [
  [1.15, -1.55],
  [1.25, -0.7],
  [1.15, 0.15],
];
const LEG_TIP = [
  [1.55, -2.35],
  [1.75, -0.55],
  [1.6, 1.15],
];

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  if (carrying) {
    const cx = u;
    const cy = v + 2.75;
    if (cx * cx + cy * cy < 0.42) {
      S.stamp(col, row, S.tileKey(palCrumb, 0.75), 1, z + 1);
      return;
    }
  }
  const eh = ellipse(u, v, 0, -1.85, 0.72, 0.6, 0);
  const et = ellipse(u, v, 0, -0.72, 0.46, 0.66, 0);
  const ep = ellipse(u, v, 0, 0.18, 0.26, 0.26, 0);
  const eg = ellipse(u, v, 0, 1.4, 0.95, 1.08, 0);
  const e = Math.min(eh, et, ep, eg);
  if (e >= 1.12) {
    limbs(u, v, col, row);
    return;
  }
  let sh = 0.48 + 0.24 * (1 - clamp01(e));
  // Glossy highlights on the head and gaster.
  const g1x = u + 0.25;
  const g1y = v - 1.05;
  const g2x = u + 0.18;
  const g2y = v + 2.0;
  if (g1x * g1x + g1y * g1y < 0.1 || g2x * g2x + g2y * g2y < 0.06) sh = 0.92;
  if (eg < 1 && (Math.floor((v - 0.6) * 2.2) & 1) === 1) sh -= 0.08; // gaster bands
  S.stamp(col, row, S.tileKey(pal, sh), softCov(e, 0.8, 1.12), z + 0.4);
}

/** Leg and antenna joints (right side, mirrored by |u|) for this frame's gait. */
const J = new Float32Array(3 * 6 * 2); // [side][leg] → root, knee, tip
const AN = new Float32Array(6);
function setLegs(): void {
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < 3; k++) {
      // Tripod gait: legs 0 and 2 on one side move with leg 1 on the other.
      const ph = gait + ((k & 1) ^ s) * Math.PI;
      const sw = Math.sin(ph) * 0.35;
      const o = (s * 3 + k) * 6;
      J[o] = 0.3;
      J[o + 1] = LEG_ROOT_V[k];
      J[o + 2] = LEG_KNEE[k][0];
      J[o + 3] = LEG_KNEE[k][1] + sw * 0.5;
      J[o + 4] = LEG_TIP[k][0];
      J[o + 5] = LEG_TIP[k][1] + sw;
    }
  }
  AN[0] = 0.25;
  AN[1] = -2.3;
  AN[2] = 0.7;
  AN[3] = -2.9;
  AN[4] = 0.55;
  AN[5] = -3.65;
}

/** Thin tiled legs and antennae (they define an ant at this size, so they get tiles, not glyphs). */
function limbs(u: number, v: number, col: number, row: number): void {
  const ax = Math.abs(u);
  const s = u < 0 ? 0 : 1;
  let d = 9;
  for (let k = 0; k < 3; k++) {
    const o = (s * 3 + k) * 6;
    d = Math.min(d, capsule(ax, v, J[o], J[o + 1], J[o + 2], J[o + 3]), capsule(ax, v, J[o + 2], J[o + 3], J[o + 4], J[o + 5]));
  }
  const dA = Math.min(capsule(ax, v, AN[0], AN[1], AN[2], AN[3]), capsule(ax, v, AN[2], AN[3], AN[4], AN[5]));
  const cov = Math.max(aaCov(d, 0.16), aaCov(dA, 0.12) * 0.9);
  // Skip the faint fringe so legs read as crisp lines, not fuzz.
  if (cov > 0.36) S.stamp(col, row, S.tileKey(pal, 0.6), cov, cur.z);
}

export const antDef: AnimalDef = {
  id: 'ant',
  label: 'Ants',
  dot: '#a47158',
  baseCount: 34,
  maxCount: 70,
  radius: RADIUS,
  clickMode: 'custom',
  edge: 'none',
  palettes: {
    body: ['#070504', '#1a1210', '#33241d', '#55392b', '#7a5240', '#a47158', '#e2b79a'],
  },
  lineShade: { body: 0.72 },
  pal: {},

  spawn(world, rng) {
    const e = world.newEntity();
    const paths = pathsFor(world);
    const path = Math.floor(rng() * paths.length);
    const dir = rng() < 0.55 ? 1 : -1;
    const d: AntData = {
      path,
      p: rng(),
      dir,
      lane: dir * range(rng, 3, 8), // keep to one side: two-way traffic passes
      mode: 0,
      target: null,
      carry: false,
    };
    e.data = d;
    e.speed = range(rng, 28, 44);
    e.scale = range(rng, 1.9, 2.3);
    e.seed = range(rng, 0, 1000);
    e.phase = range(rng, 0, 10);
    pathAt(paths[path], d.p);
    e.x = PT.x + paths[path].nx * d.lane;
    e.y = PT.y + paths[path].ny * d.lane;
    e.heading = Math.atan2(PT.ty * dir, PT.tx * dir);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as AntData;
    const paths = pathsFor(world);
    const P = paths[d.path % paths.length];
    const sp = e.speed * (d.mode === 1 ? 1.5 : 1);
    let want = e.heading;

    if (d.mode === 1) {
      // Fetching: the crumb may already be gone.
      const t = d.target;
      if (!t || world.pellets.indexOf(t) < 0) {
        d.mode = 2;
        d.target = null;
      } else {
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        if (dx * dx + dy * dy < 49) {
          world.takePellet(world.pellets.indexOf(t));
          d.carry = true;
          d.mode = 2;
          d.target = null;
        } else want = Math.atan2(dy, dx);
      }
    }
    if (d.mode === 2) {
      // Head back to the trail a little ahead of where we left it.
      pathAt(P, d.p);
      const tx = PT.x + P.nx * d.lane - e.x;
      const ty = PT.y + P.ny * d.lane - e.y;
      if (tx * tx + ty * ty < 100) d.mode = 0;
      else want = Math.atan2(ty, tx);
    }
    if (d.mode === 0) {
      d.p += (d.dir * sp * dt) / P.len;
      if (d.p > 1.02 || d.p < -0.02) {
        // Off the edge: come back in at the other end (crumb delivered).
        d.p = d.p > 1 ? -0.02 : 1.02;
        d.carry = false;
        pathAt(P, d.p);
        e.x = PT.x + P.nx * d.lane;
        e.y = PT.y + P.ny * d.lane;
      }
      pathAt(P, d.p);
      const tx = PT.x + P.nx * d.lane - e.x;
      const ty = PT.y + P.ny * d.lane - e.y;
      want = Math.atan2(PT.ty * d.dir + ty * 0.08, PT.tx * d.dir + tx * 0.08);
    }
    // A slight zig-zag, like a real ant.
    want += Math.sin(world.t * 9 + e.seed) * 0.22;
    e.heading += angleDiff(e.heading, want) * approach(10, dt);
    e.vx = Math.cos(e.heading) * sp;
    e.vy = Math.sin(e.heading) * sp;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.phase += dt * sp * 0.28;
    e.drawHeading = e.heading;
  },

  onClick(world, x, y) {
    // Drop a crumb (plus a couple of tiny bits) and send the nearest free ants for it.
    world.addPellet(x, y, CRUMB_LIFE, 1);
    const crumb = world.pellets[world.pellets.length - 1];
    for (let n = 0; n < FETCHERS; n++) {
      let best: Entity | null = null;
      let bd = 420 * 420;
      for (const e of world.entities) {
        const d = e.data as AntData;
        if (d.mode !== 0 || d.carry) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      if (!best) break;
      const d = best.data as AntData;
      d.mode = 1;
      d.target = crumb;
    }
    const first = Object.keys(this.palettes)[0];
    world.ripple(x, y, 26, this.pal[first], 0.5);
  },

  render(e, s, world) {
    S = s;
    cur = e;
    pal = this.pal.body;
    palCrumb = world.crumbPal;
    gait = e.phase;
    carrying = (e.data as AntData).carry;
    setLegs();
    s.forEachCell(e, RADIUS, cellFn);
  },
};
