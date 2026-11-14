import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { localToWorld, placeAtEdge } from './common';
import { capsule, clamp01, ellipse, G, sdCov, sdTriangle, smooth } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise, vnoise2 } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Whale (a humpback), the showpiece: one ~60-cell animal drifting slowly across the hero.
// Knobbly head with twin blowholes, mottled blue-grey back with pale scars, a small dorsal hump,
// very long white-edged pectoral fins that flex slowly, and broad notched flukes that beat.
// Every so often it spouts a spray of glyph droplets; clicking on it makes it spout and slap its tail.
const HEAD = -29; // head tip, local v (cells)
const TAIL = 22; // tail stock end
const RADIUS = 36;
const DROPS = 60;

interface WhaleData {
  spoutIn: number; // s until the next spout
  drops: Float32Array; // DROPS × (x, y, vx, vy, age)
  dropN: number;
  slap: number; // s left on a tail slap (bigger fluke beat + ripple)
}

let S: Stamper;
let cur: Entity;
let pal = 0;
let palPale = 0;
let beat = 0; // fluke beat −1..1
let fin = 0; // pectoral flex
let sway = 0; // lateral bend of the tail section

/** Body half-width (cells) along v: blunt head, widest about a third back, slim tail stock. */
function halfWidth(v: number): number {
  const t = (v - HEAD) / (TAIL - HEAD); // 0 head … 1 tail
  if (t < 0) return 0;
  if (t > 1) return 0;
  if (t < 0.12) return 4.8 * Math.sqrt(t / 0.12) * (0.8 + 0.2 * (t / 0.12));
  if (t < 0.38) return 4.8 + 1.3 * Math.sin(((t - 0.12) / 0.26) * (Math.PI / 2));
  return 6.1 * Math.pow(1 - (t - 0.38) / 0.62, 1.2) + 0.8;
}

/** Lateral offset of the spine at v (the tail end sways a little as it swims). */
const spineU = (v: number): number => sway * Math.pow(clamp01((v - 0) / (TAIL - 0)), 2) * 2.2;

const fract = (x: number): number => x - Math.floor(x);

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const cu = u - spineU(v);
  const ax = Math.abs(cu);

  // ---- body (O(1) per cell: width is a function of v) ----
  const hw = halfWidth(v);
  if (hw > 0 && ax < hw + 0.8) {
    const dn = ax / hw; // 0 spine … 1 flank edge
    const cov = sdCov((ax - hw) * 1.1);
    if (cov > 0.04) {
      let p = pal;
      // Rounded back lit from the upper left, darker toward the flanks.
      let sh = 0.46 + 0.3 * (1 - dn * dn) - 0.08 * (cu / hw);
      sh += 0.06 * Math.sin(v * 0.16 - cur.phase * 0.6) * (1 - dn); // a sheen rolling along the back
      sh += (vnoise2(u * 0.22 + cur.seed, v * 0.22) - 0.5) * 0.14; // broad mottling
      sh += (vnoise2(u * 0.7 + 40, v * 0.7 + cur.seed) - 0.5) * 0.07; // fine mottling
      // Head: rows of pale knobs (tubercles) along the rostrum, and the twin blowholes behind them.
      const hv = v - HEAD;
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
      sh -= 0.3 * smooth(0.75, 1.02, dn) * sh; // flank shade
      S.stamp(col, row, S.tileKey(p, sh), cov, z + 0.4);
      if (cov > 0.6) return;
    }
  }

  // ---- pectoral fins: very long and pale, with a scalloped leading edge, swept back ----
  if (v > HEAD + 7 && v < 12) {
    const rootU = 4.4;
    const rootV = HEAD + 11;
    const tipU = 18.0 + fin * 1.0;
    const tipV = HEAD + 27 + fin * 1.8;
    const ex = tipU - rootU;
    const ey = tipV - rootV;
    const t0 = clamp01(((ax - rootU) * ex + (v - rootV) * ey) / (ex * ex + ey * ey));
    // Bow the fin backward in the middle (a gentle curve, like a humpback's).
    const bow = 1.6 * Math.sin(Math.PI * t0);
    const fv = v - bow;
    const t = clamp01(((ax - rootU) * ex + (fv - rootV) * ey) / (ex * ex + ey * ey));
    const lead = (ax - rootU) * ey - (fv - rootV) * ex < 0;
    const knob = lead ? 0.3 * Math.max(0, Math.sin(t * 30)) * (1 - t) : 0;
    const r = 2.2 * (1 - t) * (0.6 + 0.4 * Math.sqrt(1 - t)) + 0.4 + knob;
    const d = capsule(ax, fv, rootU, rootV, tipU, tipV);
    const cov = sdCov((d - r) * 1.3);
    if (cov > 0.04) {
      // Dark near the body, washing out to white toward the tip, with grey mottles.
      let sh = 0.42 + 0.45 * smooth(0.05, 0.5, t) + 0.12 * (1 - d / r);
      sh -= (vnoise2(ax * 0.9 + cur.seed, v * 0.9) > 0.68 ? 0.25 : 0) * smooth(0.1, 0.4, t);
      const p = t < 0.12 ? pal : palPale;
      if (t < 0.12) sh = 0.5 + 0.15 * (1 - d / r);
      sh -= 0.3 * smooth(0.55, 1, d / r) * sh; // edge
      S.stamp(col, row, S.tileKey(p, sh), cov, z + 0.2);
      return;
    }
  }

  // ---- flukes: two broad pointed lobes with a centre notch and a ragged pale trailing edge ----
  if (v > TAIL - 3) {
    const fv = v - TAIL + 0.6;
    const span = 1 - 0.22 * Math.abs(beat); // lobes foreshorten as they beat up/down
    const lx = ax / span;
    const lv = fv - beat * 0.5 * (lx / 9);
    let sd = sdTriangle(lx, lv, 0.2, -1.4, 10.5, 5.6, 0.6, 4.6) - 0.5;
    // Concave trailing edge and the notch.
    const sc = 4.6 - Math.hypot(lx - 5.4, lv - 9.4);
    if (sc > sd) sd = sc;
    if (lx < 0.6 && lv > 3.0) sd = Math.max(sd, 0.6 - lx);
    if (sd < 0.6) {
      let p = pal;
      let sh = 0.5 + 0.15 * smooth(0, -1.5, sd);
      // Pale underside showing along the serrated trailing edge.
      if (sd > -0.7 && lv > 2.0 + lx * 0.3 && fract(lx * 0.9) < 0.6) {
        p = palPale;
        sh = 0.55;
      }
      sh += (vnoise2(lx * 0.6 + cur.seed, lv * 0.6) - 0.5) * 0.1;
      S.stamp(col, row, S.tileKey(p, sh), sdCov(sd), z + 0.3);
    }
  }
}

function spout(e: Entity, d: WhaleData, world: WorldView, power = 1): void {
  // Droplets burst up from the blowholes and spread (seen from above: a radiating plume).
  const P = { x: 0, y: 0 };
  localToWorld(e, world.cell, 0, HEAD + 8.5, P);
  const r = world.rng;
  d.dropN = DROPS;
  for (let i = 0; i < DROPS; i++) {
    const a = r() * Math.PI * 2;
    const sp = range(r, 60, 230) * power;
    const o = i * 5;
    d.drops[o] = P.x + range(r, -4, 4);
    d.drops[o + 1] = P.y + range(r, -4, 4);
    d.drops[o + 2] = Math.cos(a) * sp + e.vx;
    d.drops[o + 3] = Math.sin(a) * sp + e.vy;
    d.drops[o + 4] = -range(r, 0, 0.25); // staggered start
  }
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
    e.data = { spoutIn: range(rng, 2, 6), drops: new Float32Array(DROPS * 5), dropN: 0, slap: 0 } satisfies WhaleData;
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.vx = Math.cos(e.heading) * e.speed;
    e.vy = Math.sin(e.heading) * e.speed;
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as WhaleData;
    e.heading += (vnoise(world.t * 0.08 + e.seed) - 0.5) * 0.4 * dt;
    const k = approach(0.5, dt);
    e.vx += (Math.cos(e.heading) * e.speed - e.vx) * k;
    e.vy += (Math.sin(e.heading) * e.speed - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    d.slap = Math.max(0, d.slap - dt);
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 2.5 * (d.slap > 0 ? 1 : 0));
    e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(0.6, dt);
    d.spoutIn -= dt;
    if (d.spoutIn <= 0) {
      spout(e, d, world);
      d.spoutIn = range(world.rng, 8, 14);
    }
    for (let i = 0; i < d.dropN; i++) {
      const o = i * 5;
      d.drops[o + 4] += dt;
      if (d.drops[o + 4] < 0) continue;
      const drag = Math.exp(-dt * 1.4);
      d.drops[o + 2] *= drag;
      d.drops[o + 3] *= drag;
      d.drops[o] += d.drops[o + 2] * dt;
      d.drops[o + 1] += d.drops[o + 3] * dt;
    }
  },

  onClick(world, x, y) {
    // Clicking the whale: it spouts and slaps its tail. Clicking water: just a ripple.
    const first = Object.keys(this.palettes)[0];
    for (const e of world.entities) {
      const dx = x - e.x;
      const dy = y - e.y;
      const reach = RADIUS * e.scale * world.cell * 0.8;
      if (dx * dx + dy * dy < reach * reach) {
        const d = e.data as WhaleData;
        spout(e, d, world, 1.4);
        d.slap = 1.6;
        d.spoutIn = range(world.rng, 8, 14);
        const T = { x: 0, y: 0 };
        localToWorld(e, world.cell, 0, TAIL + 3, T);
        world.ripple(T.x, T.y, 120, this.pal[first], 0.9);
        return;
      }
    }
    world.ripple(x, y, 60, this.pal[first], 0.6);
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.skin;
    palPale = this.pal.pale;
    const d = e.data as WhaleData;
    beat = Math.sin(e.phase) * (d.slap > 0 ? 1 : 0.6);
    fin = Math.sin(e.phase * 0.5 + 1);
    sway = Math.sin(e.phase - 0.8) * 0.6;
    s.forEachCell(e, RADIUS, cellFn);
    // Spout droplets: glyph-only spray that fades as it spreads.
    const c = s.cell;
    for (let i = 0; i < d.dropN; i++) {
      const o = i * 5;
      const age = d.drops[o + 4];
      if (age < 0 || age > 1.8) continue;
      const col = Math.floor(d.drops[o] / c);
      const row = Math.floor(d.drops[o + 1] / c);
      const a = 0.95 * (1 - age / 1.8);
      // A bright misty core at first, then glyph droplets as the spray spreads.
      if (age < 0.25) s.stamp(col, row, s.tileKey(palPale, 0.9), a * 0.8, e.z + 2);
      else s.stamp(col, row, s.lineKey(palPale, age < 0.7 ? G.o : age < 1.2 ? G[':'] : G['.']), a, e.z + 2);
    }
  },
};
