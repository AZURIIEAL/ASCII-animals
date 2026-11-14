import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { localToWorld, placeAtEdge } from './common';
import { capsule, clamp01, ellipse, G, sdCov, sdTriangle, smooth } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise, vnoise2 } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Whale (a humpback), the showpiece: one big animal living a full breathing cycle across the hero.
// Look: knobbly head with twin blowholes, mottled blue-grey back with sunlight rippling over it, a
// small dorsal hump, very long white flippers with a scalloped edge, broad notched flukes.
// Life: it cruises at the surface leaving a wake and flat "fluke prints", spouting a few times; then
// it dives — the front tips down and the flukes lift clear of the water, showing their pale underside —
// stays deep (dim, smaller, trailing bubbles) and rises again with a big spout. The body bends into
// turns, the flippers sweep, and now and then it slaps a flipper. Click it and it breaches: it surges up
// toward you, rolls to show its grooved white throat, flippers spread, then crashes back in a ring of
// spray. Click the water and it turns to have a look.
const HEAD = -29; // head tip, local v (cells)
const TAIL = 22; // tail stock end
const RADIUS = 40;
const POOL = 260; // particles
const PF = 7; // floats per particle: x, y, vx, vy, age, life, kind

const CRUISE = 0;
const DIVE = 1;
const DEEP = 2;
const RISE = 3;
const BREACH = 4;
const DIVE_T = 6;
const RISE_T = 4.5;
const BREACH_T = 3.2;

// Particle kinds.
const SPRAY = 0;
const FOAM = 1;
const BUBBLE = 2;
const SPLASH = 3;

interface WhaleData {
  baseScale: number;
  mode: number;
  modeT: number; // s in the current mode
  modeLen: number; // s the current mode lasts (DEEP)
  breaths: number; // spouts left before the next dive
  spoutIn: number; // s until the next spout (cruise)
  depth: number; // 0 surface … 1 deep
  bend: number; // smoothed turn rate → body curve
  lastHead: number;
  slapIn: number; // s until the next flipper slap
  slapT: number; // s into a flipper slap (−1 = none)
  slapSide: number;
  curiousT: number; // s left turning toward a click
  tx: number;
  ty: number;
  splashed: boolean;
  wakeAcc: number;
  bubbleAcc: number;
  lastBeat: number;
  parts: Float32Array;
  pw: number; // next particle slot (ring buffer)
}

// ---- per-frame render state (module-level: no closures per cell) ----
let S: Stamper;
let cur: Entity;
let pal = 0;
let palPale = 0;
let beat = 0; // fluke beat −1..1
let sway = 0; // lateral sway of the tail section
let bend = 0; // body curve into a turn
let depth = 0; // whole-body depth
let tilt = 0; // dive: the front goes down first
let lift = 0; // dive: flukes raised clear of the water
let surge = 0; // breach: body raised toward the viewer
let roll = 0; // breach: rolled onto its side, showing the throat
let glint = 0; // time, for the sunlight on the back
const TIPU = new Float32Array(2); // flipper tips per side (0 left, 1 right)
const TIPV = new Float32Array(2);
const FINB = new Float32Array(2); // flipper brightness boost per side

/** Body half-width (cells) along v: blunt head, widest about a third back, slim tail stock. */
function halfWidth(v: number): number {
  const t = (v - HEAD) / (TAIL - HEAD); // 0 head … 1 tail
  if (t < 0 || t > 1) return 0;
  if (t < 0.12) return 4.8 * Math.sqrt(t / 0.12) * (0.8 + 0.2 * (t / 0.12));
  if (t < 0.38) return 4.8 + 1.3 * Math.sin(((t - 0.12) / 0.26) * (Math.PI / 2));
  return 6.1 * Math.pow(1 - (t - 0.38) / 0.62, 1.2) + 0.8;
}

/** Lateral offset of the spine at v: the tail sways as it swims, and the whole body arcs into a turn. */
const spineU = (v: number): number => sway * Math.pow(clamp01(v / TAIL), 2) * 2.2 + bend * 0.009 * (v + 4) * (v + 4);

const fract = (x: number): number => x - Math.floor(x);

/** Local depth of a body point at v: during a dive the head goes down first. */
const localDepth = (v: number): number => clamp01(depth + tilt * clamp01((TAIL - v) / (TAIL - HEAD)));

/** Sunlight through the surface: bright wandering ridges, strongest in shallow water. */
function caustic(u: number, v: number): number {
  const n = vnoise2(u * 0.16 + glint * 0.35, v * 0.16 - glint * 0.2);
  const r = 1 - Math.abs(2 * n - 1);
  return r * r * r * r;
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const cu = u - spineU(v);
  const ax = Math.abs(cu);
  const side = cu < 0 ? 0 : 1;

  // ---- flukes (drawn first when raised: they're nearer the viewer than the diving body) ----
  if (v > TAIL - 3) {
    const big = 1 + 0.5 * lift; // raised flukes are closer, so bigger
    const fv = (v - TAIL + 0.6) / big;
    const span = 1 - 0.22 * Math.abs(beat) * (1 - lift);
    const lx = ax / span / big;
    const lv = fv - beat * 0.5 * (lx / 9);
    let sd = sdTriangle(lx, lv, 0.2, -1.4, 10.5, 5.6, 0.6, 4.6) - 0.5;
    const sc = 4.6 - Math.hypot(lx - 5.4, lv - 9.4); // concave trailing edge
    if (sc > sd) sd = sc;
    if (lx < 0.6 && lv > 3.0) sd = Math.max(sd, 0.6 - lx); // centre notch
    if (sd < 0.6) {
      let p = pal;
      let sh = 0.5 + 0.15 * smooth(0, -1.5, sd);
      if (lift > 0.35) {
        // Raised: the pale underside shows, with its unique dark markings.
        p = palPale;
        sh = 0.62 + 0.25 * lift;
        if (vnoise2(lx * 0.45 + cur.seed, lv * 0.7) > 0.6 || lv < 0.4 + lx * 0.15) sh = 0.18;
      } else if (sd > -0.7 && lv > 2.0 + lx * 0.3 && fract(lx * 0.9) < 0.6) {
        p = palPale; // pale serrated trailing edge
        sh = 0.55;
      }
      sh += (vnoise2(lx * 0.6 + cur.seed, lv * 0.6) - 0.5) * 0.1;
      const dl = lift > 0 ? depth * (1 - lift) : localDepth(v);
      sh *= 1 - 0.35 * dl;
      S.stamp(col, row, S.tileKey(p, sh), sdCov(sd) * (1 - 0.55 * dl), z + (lift > 0.2 ? 1.2 : 0.3));
      if (lift > 0.2) return;
    }
  }

  // ---- body (O(1) per cell: width is a function of v) ----
  const hw = halfWidth(v);
  if (hw > 0 && ax < hw + 0.8) {
    const dn = ax / hw; // 0 spine … 1 flank edge
    const cov = sdCov((ax - hw) * 1.1);
    if (cov > 0.04) {
      let p = pal;
      // Rounded back lit from the upper left, darker toward the flanks.
      let sh = 0.46 + 0.3 * (1 - dn * dn) - 0.08 * (cu / hw);
      sh += (vnoise2(u * 0.22 + cur.seed, v * 0.22) - 0.5) * 0.14; // broad mottling
      sh += (vnoise2(u * 0.7 + 40, v * 0.7 + cur.seed) - 0.5) * 0.07; // fine mottling
      const hv = v - HEAD;
      // Rolled (breach): the white throat with its long grooves shows along one side.
      const belly = (roll * 0.42 - (1 - cu / hw) * 0.5) * (1 - smooth(18, 32, hv));
      if (roll > 0.05 && belly > 0) {
        p = palPale;
        sh = 0.55 + 0.3 * clamp01(belly * 2);
        if (fract(cu * 1.5 + 0.25) < 0.4) sh -= 0.32; // ventral pleats
      } else {
        // Head: rows of pale knobs (tubercles) on the rostrum, the twin blowholes behind them.
        if (hv < 8 && dn < 0.8) {
          const kx = fract(cu / 1.3 + 0.5) - 0.5;
          const ky = fract(hv / 1.5) - 0.5;
          if (kx * kx + ky * ky < 0.05) {
            p = palPale;
            sh = 0.5;
          }
        }
        const bx = ax - 0.6;
        const by = v - (HEAD + 9.2);
        if (bx * bx * 4 + by * by < 0.3) {
          p = pal;
          sh = 0.04;
        }
        // Sparse pale barnacle spots and scars.
        if (dn < 0.9 && hash2(col * 3 + 7, row * 5 + cur.id) > (hv < 10 ? 0.95 : 0.985)) {
          p = palPale;
          sh = 0.35;
        }
        // Small dorsal fin on a hump, then a row of knuckles down the tail stock.
        const dh = ellipse(cu, v, 0, 9.5, 0.95, 2.2, 0);
        if (dh < 1) sh += 0.12 * (1 - dh) * (cu < 0 ? 1 : -0.6);
        else if (v > 12 && ax < 0.45 && fract(v / 1.8) < 0.45) sh += 0.1;
      }
      const dl = localDepth(v);
      sh += 0.16 * caustic(u, v) * (1 - dl) * (1 - dn); // sunlight on the back
      sh += 0.07 * surge;
      sh -= 0.3 * smooth(0.75, 1.02, dn) * sh; // flank shade
      sh *= 1 - 0.38 * dl;
      S.stamp(col, row, S.tileKey(p, sh), cov * (1 - 0.55 * dl), z + 0.4);
      if (cov > 0.6) return;
    }
  }

  // ---- pectoral flippers: very long and pale, scalloped leading edge, each side posed separately ----
  if (v > HEAD + 4 && v < 14) {
    const rootU = 4.4;
    const rootV = HEAD + 11;
    const tipU = TIPU[side];
    const tipV = TIPV[side];
    const ex = tipU - rootU;
    const ey = tipV - rootV;
    const el = ex * ex + ey * ey;
    const t0 = clamp01(((ax - rootU) * ex + (v - rootV) * ey) / el);
    const bow = 1.6 * Math.sin(Math.PI * t0); // bowed backward in the middle
    const fv = v - bow;
    const t = clamp01(((ax - rootU) * ex + (fv - rootV) * ey) / el);
    const lead = (ax - rootU) * ey - (fv - rootV) * ex < 0;
    const knob = lead ? 0.3 * Math.max(0, Math.sin(t * 30)) * (1 - t) : 0;
    const r = 2.2 * (1 - t) * (0.6 + 0.4 * Math.sqrt(1 - t)) + 0.4 + knob;
    const d = capsule(ax, fv, rootU, rootV, tipU, tipV);
    const cov = sdCov((d - r) * 1.3);
    if (cov > 0.04) {
      // Dark at the root, washing out to white toward the tip, with grey mottles.
      let sh = 0.42 + 0.45 * smooth(0.05, 0.5, t) + 0.12 * (1 - d / r) + FINB[side];
      sh -= (vnoise2(ax * 0.9 + cur.seed, v * 0.9) > 0.68 ? 0.25 : 0) * smooth(0.1, 0.4, t);
      const p = t < 0.12 ? pal : palPale;
      if (t < 0.12) sh = 0.5 + 0.15 * (1 - d / r);
      sh -= 0.3 * smooth(0.55, 1, d / r) * sh; // edge
      const dl = localDepth(rootV);
      sh *= 1 - 0.38 * dl;
      S.stamp(col, row, S.tileKey(p, sh), cov * (1 - 0.55 * dl), z + 0.2);
    }
  }
}

// ---------- particles ----------

function emit(d: WhaleData, x: number, y: number, vx: number, vy: number, life: number, kind: number, delay = 0): void {
  const o = d.pw * PF;
  d.pw = (d.pw + 1) % POOL;
  const P = d.parts;
  P[o] = x;
  P[o + 1] = y;
  P[o + 2] = vx;
  P[o + 3] = vy;
  P[o + 4] = -delay;
  P[o + 5] = life;
  P[o + 6] = kind;
}

const W = { x: 0, y: 0 };

function spout(e: Entity, d: WhaleData, world: WorldView, power = 1): void {
  // Droplets burst up from the blowholes and spread (seen from above: a radiating plume).
  localToWorld(e, world.cell, 0, HEAD + 8.5, W);
  const r = world.rng;
  const n = Math.round(70 * power);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const sp = range(r, 50, 230) * power;
    emit(d, W.x + range(r, -4, 4), W.y + range(r, -4, 4), Math.cos(a) * sp + e.vx, Math.sin(a) * sp + e.vy, 1.8, SPRAY, range(r, 0, 0.3));
  }
}

/** A ring of white water around the whole body, for a breach landing. */
function splashRing(e: Entity, d: WhaleData, world: WorldView): void {
  const r = world.rng;
  for (let i = 0; i < 150; i++) {
    const v = range(r, HEAD, TAIL + 4);
    const sd = r() < 0.5 ? -1 : 1;
    localToWorld(e, world.cell, sd * (halfWidth(v) + 1), v, W);
    const a = r() * Math.PI * 2;
    const sp = range(r, 40, 260);
    emit(d, W.x, W.y, Math.cos(a) * sp, Math.sin(a) * sp, range(r, 1.2, 2.2), SPLASH, range(r, 0, 0.25));
  }
}

function stepParticles(d: WhaleData, dt: number): void {
  const P = d.parts;
  for (let i = 0; i < POOL; i++) {
    const o = i * PF;
    if (P[o + 4] >= P[o + 5]) continue;
    P[o + 4] += dt;
    if (P[o + 4] < 0) continue;
    const k = P[o + 6];
    const drag = Math.exp(-dt * (k === FOAM ? 0.9 : k === BUBBLE ? 2.5 : 1.4));
    P[o + 2] *= drag;
    P[o + 3] *= drag;
    P[o] += P[o + 2] * dt;
    P[o + 1] += P[o + 3] * dt;
  }
}

function setMode(d: WhaleData, mode: number): void {
  d.mode = mode;
  d.modeT = 0;
}

export const whale: AnimalDef = {
  id: 'whale',
  label: 'Whale',
  dot: '#93b1c7',
  baseCount: 1,
  minCount: 1,
  maxCount: 1,
  radius: RADIUS,
  clickMode: 'custom',
  edge: 'wrap',
  palettes: {
    skin: ['#03060a', '#08121d', '#0f2133', '#19344d', '#274b69', '#3b6585', '#5e86a3', '#93b1c7', '#d3e1ea'],
    pale: ['#1a2530', '#5d7486', '#a9bccb', '#e3edf4', '#ffffff'],
  },
  lineShade: { pale: 0.95 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, world.w * 0.25, world.w * 0.75);
    // Start above or below the middle band, where the hero text usually sits.
    e.y = rng() < 0.5 ? range(rng, world.h * 0.15, world.h * 0.3) : range(rng, world.h * 0.7, world.h * 0.85);
    e.heading = rng() < 0.5 ? range(rng, -0.4, 0.4) : Math.PI + range(rng, -0.4, 0.4);
    e.speed = range(rng, 34, 46);
    e.rate = range(rng, 0.3, 0.4); // fluke beats per second
    e.phase = range(rng, 0, 10);
    // Scale so the whale is ~85 cells long on a desktop hero, less on small screens.
    e.scale = Math.max(0.75, Math.min(1.5, world.w / 1250));
    e.seed = range(rng, 0, 1000);
    e.data = {
      baseScale: e.scale,
      mode: CRUISE,
      modeT: 0,
      modeLen: 0,
      breaths: Math.floor(range(rng, 2, 4.99)),
      spoutIn: range(rng, 1.5, 4),
      depth: 0,
      bend: 0,
      lastHead: e.heading,
      slapIn: range(rng, 14, 26),
      slapT: -1,
      slapSide: 0,
      curiousT: 0,
      tx: 0,
      ty: 0,
      splashed: false,
      wakeAcc: 0,
      bubbleAcc: 0,
      lastBeat: 0,
      parts: new Float32Array(POOL * PF),
      pw: 0,
    } satisfies WhaleData;
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.vx = Math.cos(e.heading) * e.speed;
    e.vy = Math.sin(e.heading) * e.speed;
    e.drawHeading = e.heading;
    (e.data as WhaleData).lastHead = e.drawHeading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as WhaleData;
    const r = world.rng;
    d.modeT += dt;

    // ---- the breathing cycle ----
    let surgeNow = 0;
    if (d.mode === CRUISE) {
      d.depth += (0 - d.depth) * approach(1.5, dt);
      d.spoutIn -= dt;
      if (d.spoutIn <= 0) {
        if (d.breaths > 0) {
          spout(e, d, world);
          d.breaths--;
          d.spoutIn = d.breaths > 0 ? range(r, 5, 8) : range(r, 3, 5);
        } else setMode(d, DIVE);
      }
      // Now and then: raise a flipper and slap it down.
      d.slapIn -= dt;
      if (d.slapIn <= 0 && d.slapT < 0) {
        d.slapT = 0;
        d.slapSide = r() < 0.5 ? 0 : 1;
        d.slapIn = range(r, 16, 30);
      }
    } else if (d.mode === DIVE) {
      if (d.modeT >= DIVE_T) {
        setMode(d, DEEP);
        d.modeLen = range(r, 9, 15);
      }
    } else if (d.mode === DEEP) {
      d.depth = 1;
      if (d.modeT >= d.modeLen) setMode(d, RISE);
    } else if (d.mode === RISE) {
      d.depth = Math.min(d.depth, 1 - smooth(0, RISE_T, d.modeT));
      if (d.modeT >= RISE_T) {
        d.depth = 0;
        setMode(d, CRUISE);
        spout(e, d, world, 1.35); // the first breath after a dive is the big one
        localToWorld(e, world.cell, 0, -4, W);
        world.ripple(W.x, W.y, 240 * e.scale, this.pal.skin, 0.55);
        d.breaths = Math.floor(range(r, 2, 4.99)) - 1;
        d.spoutIn = range(r, 5, 8);
      }
    } else if (d.mode === BREACH) {
      const p = d.modeT / BREACH_T;
      surgeNow = p < 0.5 ? Math.sin((Math.PI / 2) * (p / 0.5)) : Math.max(0, 1 - (p - 0.5) / 0.12);
      d.depth += (0 - d.depth) * approach(4, dt);
      if (p >= 0.55 && !d.splashed) {
        d.splashed = true;
        splashRing(e, d, world);
        spout(e, d, world, 0.8);
        world.ripple(e.x, e.y, 420 * e.scale, this.pal.skin, 0.9);
      }
      if (p >= 0.62) d.depth = Math.max(d.depth, 0.45 * Math.sin(Math.PI * clamp01((p - 0.62) / 0.38)));
      if (p >= 1) {
        setMode(d, CRUISE);
        d.spoutIn = range(r, 4, 7);
        d.breaths = Math.max(d.breaths, 1);
      }
    }
    if (d.mode === DIVE) {
      const p = d.modeT / DIVE_T;
      d.depth = smooth(0.3, 1, p);
    }

    // ---- swimming ----
    let wander = (vnoise(world.t * 0.08 + e.seed) - 0.5) * (d.mode === DEEP ? 0.9 : 0.4);
    if (d.curiousT > 0) {
      d.curiousT -= dt;
      const dx = d.tx - e.x;
      const dy = d.ty - e.y;
      if (dx * dx + dy * dy > 180 * 180) wander += angleDiff(e.heading, Math.atan2(dy, dx)) * 0.45;
    }
    e.heading += wander * dt;
    const sp = e.speed * (d.mode === BREACH ? 1.6 : d.mode === DEEP ? 0.85 : 1);
    const k = approach(0.5, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const fast = d.mode === BREACH || d.mode === RISE ? 1.8 : d.mode === DIVE ? 1.3 : 1;
    e.phase += dt * e.rate * Math.PI * 2 * fast;
    e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(0.6, dt);
    // Turn rate → how much the body arcs into the turn.
    const turn = angleDiff(d.lastHead, e.drawHeading) / Math.max(dt, 1e-4);
    d.lastHead = e.drawHeading;
    d.bend += (Math.max(-1, Math.min(1, turn * 6)) - d.bend) * approach(1.2, dt);
    // Seen from above, a whale surging toward the viewer looks bigger; a deep one smaller.
    e.scale = d.baseScale * (1 - 0.12 * d.depth) * (1 + 0.28 * surgeNow);
    if (d.slapT >= 0) {
      d.slapT += dt;
      if (d.slapT > 1.1 && d.slapT - dt <= 1.1) {
        // The flipper hits the water.
        // The flipper hits the water along its whole length.
        const sd = d.slapSide ? 1 : -1;
        localToWorld(e, world.cell, sd * (4.4 + Math.sin(1.15) * 15), HEAD + 11 + Math.cos(1.15) * 15, W);
        world.ripple(W.x, W.y, 110 * e.scale, this.pal.skin, 0.7);
        for (let i = 0; i < 70; i++) {
          const t = r();
          localToWorld(e, world.cell, sd * (4.4 + Math.sin(1.15) * 23 * t), HEAD + 11 + Math.cos(1.15) * 23 * t, W);
          const a = r() * Math.PI * 2;
          const s2 = range(r, 30, 190);
          emit(d, W.x, W.y, Math.cos(a) * s2, Math.sin(a) * s2, range(r, 0.9, 1.7), SPLASH, range(r, 0, 0.12));
        }
      }
      if (d.slapT > 1.8) d.slapT = -1;
    }

    // ---- wake, fluke prints and bubbles ----
    const c = world.cell;
    if (d.depth < 0.35) {
      d.wakeAcc += dt * 26 * (1 - d.depth / 0.35);
      while (d.wakeAcc >= 1) {
        d.wakeAcc--;
        const sd = r() < 0.5 ? -1 : 1;
        const atHead = r() < 0.45;
        const v = atHead ? HEAD + range(r, 1, 6) : TAIL + range(r, 0, 4);
        localToWorld(e, c, sd * (atHead ? halfWidth(v) + 0.6 : range(r, 0.5, 6)), v, W);
        // Push the water out sideways (a V-shaped bow wave and a spreading wake).
        const fx = Math.cos(e.drawHeading);
        const fy = Math.sin(e.drawHeading);
        const out = range(r, 14, 34) * (atHead ? 1.4 : 1);
        emit(d, W.x, W.y, -fy * sd * out - fx * 6, fx * sd * out - fy * 6, range(r, 1.8, 3.2), FOAM);
      }
      // A flat oval "footprint" left on the surface after each fluke stroke.
      const b = Math.sin(e.phase);
      if (d.lastBeat < 0 && b >= 0) {
        localToWorld(e, c, 0, TAIL + 4, W);
        world.ripple(W.x, W.y, 34 * e.scale, this.pal.skin, 0.32);
      }
      d.lastBeat = b;
    } else {
      d.bubbleAcc += dt * 10 * d.depth;
      while (d.bubbleAcc >= 1) {
        d.bubbleAcc--;
        localToWorld(e, c, range(r, -1.5, 1.5), HEAD + 8.5 + range(r, -1, 1), W);
        emit(d, W.x, W.y, range(r, -12, 12) + e.vx * 0.3, range(r, -12, 12) + e.vy * 0.3, range(r, 1.0, 1.8), BUBBLE);
      }
    }
    stepParticles(d, dt);
  },

  onClick(world, x, y) {
    // Clicking the whale: it breaches. Clicking the water: a ripple, and the whale comes to look.
    for (const e of world.entities) {
      const d = e.data as WhaleData;
      const dx = x - e.x;
      const dy = y - e.y;
      const reach = RADIUS * e.scale * world.cell * 0.75;
      if (dx * dx + dy * dy < reach * reach) {
        if (d.mode !== BREACH) {
          setMode(d, BREACH);
          d.splashed = false;
          d.slapT = -1;
        }
        return;
      }
      d.curiousT = 6;
      d.tx = x;
      d.ty = y;
    }
    world.ripple(x, y, 60, this.pal.skin, 0.6);
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.skin;
    palPale = this.pal.pale;
    const d = e.data as WhaleData;
    depth = d.depth;
    bend = d.bend;
    glint = e.phase * 0.5 + e.seed;
    tilt = 0;
    lift = 0;
    surge = 0;
    roll = 0;
    if (d.mode === DIVE) {
      const p = d.modeT / DIVE_T;
      tilt = 0.75 * Math.sin(Math.PI * clamp01(p / 0.7)); // head goes down first…
      lift = Math.sin(Math.PI * clamp01((p - 0.25) / 0.7)); // …then the flukes rise and slide under
    } else if (d.mode === BREACH) {
      const p = d.modeT / BREACH_T;
      surge = p < 0.5 ? Math.sin((Math.PI / 2) * (p / 0.5)) : Math.max(0, 1 - (p - 0.5) / 0.12);
      roll = Math.sin(Math.PI * clamp01((p - 0.1) / 0.55));
    }
    beat = Math.sin(e.phase) * (d.mode === BREACH ? 1 : 0.6);
    sway = Math.sin(e.phase - 0.8) * 0.6 * (1 - lift);
    // Flippers: a slow sweep; the inner one tucks in a turn; spread wide in a breach; one raised to slap.
    const sweep = Math.sin(e.phase * 0.5 + 1);
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd ? 1 : -1;
      let a = 0.87 - 0.12 * sweep + 0.55 * surge + sg * bend * 0.35;
      let len = 21.5;
      FINB[sd] = 0;
      if (d.slapT >= 0 && d.slapSide === sd) {
        const up = d.slapT < 1.1 ? Math.sin((Math.PI / 2) * (d.slapT / 1.1)) : Math.max(0, 1 - (d.slapT - 1.1) / 0.3);
        a += 0.6 * up; // swung forward and up
        len *= 1 + 0.2 * up; // raised toward the viewer
        FINB[sd] = 0.15 * up;
      }
      TIPU[sd] = 4.4 + Math.sin(a) * len;
      TIPV[sd] = HEAD + 11 + Math.cos(a) * len;
    }
    s.forEachCell(e, RADIUS, cellFn);

    // Particles: spray, foam, bubbles, splash.
    const c = s.cell;
    const P = d.parts;
    for (let i = 0; i < POOL; i++) {
      const o = i * PF;
      const age = P[o + 4];
      const life = P[o + 5];
      if (age < 0 || age >= life) continue;
      const col = Math.floor(P[o] / c);
      const row = Math.floor(P[o + 1] / c);
      const t = age / life;
      const kind = P[o + 6];
      if (kind === FOAM) {
        const g = t < 0.3 ? G['='] : t < 0.65 ? G['-'] : G['.'];
        s.stamp(col, row, s.lineKey(palPale, g), 0.85 * (1 - t), e.z - 1);
      } else if (kind === BUBBLE) {
        // Rising bubbles swell as they near the surface, then pop.
        if (t < 0.35) s.stamp(col, row, s.lineKey(palPale, G['·']), 0.8, e.z + 2);
        else if (t < 0.85) s.stamp(col, row, s.lineKey(palPale, G.o), 0.95, e.z + 2);
        else s.stamp(col, row, s.tileKey(palPale, 0.75), 0.6, e.z + 2);
      } else {
        // Spray / splash: a bright misty core at first, then glyph droplets as it spreads.
        const a = (kind === SPLASH ? 1 : 0.95) * (1 - t);
        if (t < 0.15) s.stamp(col, row, s.tileKey(palPale, 0.92), a * 0.85, e.z + 2);
        else s.stamp(col, row, s.lineKey(palPale, t < 0.4 ? G.o : t < 0.7 ? G[':'] : G['.']), a, e.z + 2);
      }
    }
  },
};
