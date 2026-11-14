import type { AnimalDef, Entity, Pellet, Stamper, WorldView } from './types';
import { clamp01, ellipse, G, softCov } from '../engine/shapes';
import { range, type Rng } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

// Ants: three-part bodies (head, thorax, glossy banded gaster) with glyph-only jointed legs in a tripod
// gait and elbowed antennae. They march in two-way columns along winding trails; a click drops a
// crumb, and the nearest ants leave the trail, pick it up and carry it home.
const RADIUS = 2.6; // body only; limbs are glyph lines
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
// Legs (right side; mirrored): root on the thorax, knee, tip. Front legs reach forward, hind legs back.
const LEG_ROOT = [
  [0.28, -1.15],
  [0.32, -0.85],
  [0.28, -0.55],
];
const LEG_KNEE = [
  [1.0, -1.6],
  [1.15, -0.95],
  [1.0, -0.05],
];
const LEG_TIP = [
  [1.3, -2.35],
  [1.7, -0.6],
  [1.55, 1.15],
];

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  if (carrying) {
    const cx = u;
    const cy = v + 3.0;
    if (cx * cx + cy * cy < 0.3) {
      S.stamp(col, row, S.tileKey(palCrumb, 0.75), 1, z + 1);
      return;
    }
  }
  // Head, thorax, petiole node and gaster, with narrow waists between them.
  const eh = ellipse(u, v, 0, -2.0, 0.7, 0.6, 0);
  const et = ellipse(u, v, 0, -0.85, 0.42, 0.62, 0);
  const ep = ellipse(u, v, 0, 0.05, 0.24, 0.22, 0);
  const eg = ellipse(u, v, 0, 1.3, 0.88, 1.02, 0);
  const e = Math.min(eh, et, ep, eg);
  if (e >= 1.12) return;
  let sh = 0.46 + 0.3 * (1 - clamp01(e));
  // Glossy highlights: one on the head, one on the gaster, a sheen along the thorax.
  const hx = u + 0.2;
  const hy = v + 2.15;
  const gx = u + 0.28;
  const gy = v - 0.95;
  if (hx * hx + hy * hy < 0.04 || gx * gx + gy * gy < 0.05) sh = 0.95;
  else if (et < 0.6 && u < 0) sh += 0.12;
  if (eg < 1 && e === eg && (Math.floor((v - 0.5) * 2.6) & 1) === 1) sh -= 0.1; // gaster bands
  // Dark compound eyes at the sides of the head.
  const ex = Math.abs(u) - 0.48;
  const ey = v + 2.05;
  if (ex * ex + ey * ey < 0.025) sh = 0.05;
  S.stamp(col, row, S.tileKey(pal, sh), softCov(e, 0.82, 1.12), z + 0.4);
}

/** Legs, antennae and mandibles as glyph lines: crisp and thin, which is what makes it an ant. */
const L = new Float32Array(2 * 32);
let K = 1; // cells per local unit
/** Append segment a→b to L, sampled about once per cell (the first point only when starting a line). */
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
  const z = e.z + 0.1;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 3; k++) {
      // Tripod gait: legs 0 and 2 on one side move with leg 1 on the other.
      const ph = gait + ((k & 1) ^ (side > 0 ? 1 : 0)) * Math.PI;
      const sw = Math.sin(ph) * 0.4;
      const lift = Math.max(0, Math.cos(ph)) * 0.12;
      const kx = LEG_KNEE[k][0] + lift;
      const ky = LEG_KNEE[k][1] + sw * 0.45;
      let n = seg(0, side * LEG_ROOT[k][0], LEG_ROOT[k][1], side * kx, ky);
      n = seg(n, side * kx, ky, side * (LEG_TIP[k][0] - lift), LEG_TIP[k][1] + sw);
      s.stampLine(e, L, n, pal, 0.95, z, G['.']);
    }
    // Elbowed antenna: a long scape out to the side, then the club bending forward.
    const wig = Math.sin(gait * 0.7 + side) * 0.15;
    let n = seg(0, side * 0.3, -2.45, side * 0.95, -2.95 + wig);
    n = seg(n, side * 0.95, -2.95 + wig, side * (0.7 + wig), -3.75);
    s.stampLine(e, L, n, pal, 0.85, z, G['o']);
    // Mandibles.
    n = seg(0, side * 0.22, -2.5, side * 0.08, -2.85);
    s.stampLine(e, L, n, pal, 0.7, z, G['.']);
  }
}

export const antDef: AnimalDef = {
  id: 'ant',
  label: 'Ants',
  dot: '#a47158',
  baseCount: 18,
  maxCount: 40,
  radius: 4.4,
  clickMode: 'custom',
  edge: 'none',
  palettes: {
    body: ['#070504', '#1a1210', '#33241d', '#55392b', '#7a5240', '#a47158', '#e2b79a'],
  },
  lineShade: { body: 0.88 },
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
      lane: dir * range(rng, 6, 16), // keep to one side: two-way traffic passes
      mode: 0,
      target: null,
      carry: false,
    };
    e.data = d;
    e.speed = range(rng, 34, 52);
    e.scale = range(rng, 2.1, 3.5);
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
    e.phase += dt * sp * 0.16;
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
    s.forEachCell(e, RADIUS, cellFn);
    limbs(e, s);
  },
};
