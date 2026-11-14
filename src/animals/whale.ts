import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { localToWorld, placeAtEdge } from './common';
import { capsule, clamp01, ellipse, G, sdCov, smooth } from '../engine/shapes';
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
  if (t < 0.12) return 5.6 * Math.sqrt(t / 0.12) * (0.8 + 0.2 * (t / 0.12));
  if (t < 0.38) return 5.6 + 1.6 * Math.sin(((t - 0.12) / 0.26) * (Math.PI / 2));
  return 7.2 * Math.pow(1 - (t - 0.38) / 0.62, 1.15) + 0.9;
}

/** Lateral offset of the spine at v (the tail end sways a little as it swims). */
const spineU = (v: number): number => sway * Math.pow(clamp01((v - 0) / (TAIL - 0)), 2) * 2.2;

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
      let sh = 0.42 + 0.18 * (1 - dn * dn); // rounded back
      sh += 0.08 * Math.sin(v * 0.18 - cur.phase * 0.6) * (1 - dn); // a sheen rolling along the back
      sh += (vnoise2(u * 0.35 + cur.seed, v * 0.35) - 0.5) * 0.16; // mottling
      if (hash2(Math.floor(u * 0.8) + 3, Math.floor(v * 0.4) + cur.id * 7) > 0.93 && dn < 0.8) sh = 0.72; // pale scars
      // Head: knobbly tubercles and the twin blowholes.
      if (v < HEAD + 7 && hash2(col * 3 + 7, row * 5) > 0.82 && dn < 0.75) sh += 0.16;
      const bx = ax - 0.75;
      const by = v - (HEAD + 8.5);
      if (bx * bx + by * by < 0.35) sh = 0.04;
      // Small dorsal hump two-thirds back.
      const dh = ellipse(cu, v, 0, 9.5, 0.9, 2.4, 0);
      if (dh < 1) sh = 0.22 + 0.15 * (1 - dh);
      sh -= 0.32 * smooth(0.7, 1.0, dn) * sh; // flank shade
      S.stamp(col, row, S.tileKey(pal, sh), cov, z + 0.4);
      if (cov > 0.6) return;
    }
  }

  // ---- pectoral fins: very long, narrow, white-edged, swept back ----
  if (v > HEAD + 6 && v < 4) {
    const rootU = 5.4;
    const rootV = HEAD + 10;
    const tipU = 17.5 + fin * 1.2;
    const tipV = HEAD + 22 + fin * 1.5;
    const t = clamp01(((ax - rootU) * (tipU - rootU) + (v - rootV) * (tipV - rootV)) / ((tipU - rootU) ** 2 + (tipV - rootV) ** 2));
    const r = 1.7 * (1 - t) + 0.45;
    const d = capsule(ax, v, rootU, rootV, tipU, tipV);
    const cov = sdCov((d - r) * 1.2);
    if (cov > 0.04) {
      // Knobbly leading edge (tubercles) and pale undersides showing at the edge.
      const lead = (ax - rootU) * (tipV - rootV) - (v - rootV) * (tipU - rootU) < 0;
      let p = pal;
      let sh = 0.36 + 0.14 * (1 - d / r);
      if (d > r - 0.55) {
        p = palPale;
        sh = lead && (Math.floor(t * 9) & 1) === 0 ? 0.9 : 0.7;
      }
      S.stamp(col, row, S.tileKey(p, sh), cov, z + 0.2);
      return;
    }
  }

  // ---- flukes: two broad lobes with a notch, beating ----
  if (v > TAIL - 3) {
    const fv = v - TAIL - 0.5;
    const span = 1 - 0.25 * Math.abs(beat); // lobes foreshorten as they beat up/down
    const lx = ax / span;
    const e = Math.min(
      ellipse(lx, fv, 5.4, 1.6 + beat * 0.6, 5.6, 1.6, 0.32),
      ellipse(lx, fv, 2.2, 0.6, 2.4, 1.4, 0.2),
    );
    if (ax < 0.5 && fv > 1.4) return; // the notch
    if (e < 1.12) {
      const trailing = fv > 1.6 + 0.35 * lx * 0.32;
      let p = pal;
      let sh = 0.34 + 0.12 * (1 - clamp01(e));
      if (trailing && e > 0.7 && (Math.floor(lx * 1.4) & 1) === 0) {
        p = palPale; // serrated pale trailing edge
        sh = 0.8;
      }
      S.stamp(col, row, S.tileKey(p, sh), sdCov((e - 1) * 4), z + 0.3);
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
