import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { aaCov, clamp01, G, smooth } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Snails: a glossy spiral shell with growth bands, a soft grey body that stretches as it creeps
// (peristalsis), eye stalks and lower tentacles, and a long glistening slime trail. A click makes it
// pull into its shell; it comes back out slowly.
const RADIUS = 6.8;
const SHELL_V = 0.55;
const SHELL_R = 2.2;

interface SnailData {
  out: number; // 0 hidden in the shell … 1 fully out
  hideT: number; // s left hiding
}

let S: Stamper;
let cur: Entity;
let palShell = 0;
let palBody = 0;
let palSlime = 0;
let out = 1;
let stretch = 0;
const stalk = new Float32Array(6);

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  // ---- shell: logarithmic-ish spiral seen from above ----
  const sx = u;
  const sy = v - SHELL_V;
  const r = Math.sqrt(sx * sx + sy * sy);
  // The whorls coil around an apex set off to one side, as on a real shell.
  const ox = sx + 0.55;
  const oy = sy - 0.25;
  const ro = Math.sqrt(ox * ox + oy * oy);
  if (r < SHELL_R + 0.6) {
    const cov = aaCov(r, SHELL_R);
    if (cov > 0.05) {
      const ang = Math.atan2(oy, ox) + Math.PI; // 0..2π
      const turn = ang / (Math.PI * 2);
      // Spiral coordinate: whorls get narrower toward the apex.
      const sp = Math.log(Math.max(ro, 0.12) / (SHELL_R + 0.6)) / 0.55 + turn;
      const band = sp - Math.floor(sp);
      let sh = 0.5 + 0.25 * (1 - r / SHELL_R) + 0.12 * band; // each whorl brightens toward its outer edge
      if (band < 0.22) sh -= 0.3; // suture line between whorls
      if (Math.floor(sp * 3) % 3 === 0) sh += 0.08; // colour bands
      sh += (hash2(Math.floor(ang * 5), Math.floor(r * 3) + cur.id) - 0.5) * 0.08; // growth lines
      const hx = u + 0.7;
      const hy = v - SHELL_V + 0.8;
      if (hx * hx + hy * hy < 0.22) sh = 0.97; // gloss
      sh -= 0.35 * smooth(SHELL_R - 0.5, SHELL_R + 0.2, r) * sh;
      S.stamp(col, row, S.tileKey(palShell, sh), cov, z + 0.6);
      if (cov > 0.6) return;
    }
  }
  if (out < 0.05) return;

  // ---- foot: tapered body from head (front) to tail tip, stretching as it creeps ----
  const head = -3.7 * out - 0.4 * stretch;
  const tail = SHELL_V + (1.2 + 2.4 * out) + 0.25 * stretch;
  const bv = v < head ? head : v > tail ? tail : v;
  const t = (bv - head) / (tail - head);
  const br = (1.15 - 0.85 * t * t) * (0.85 + 0.15 * out);
  const d = Math.sqrt(u * u + (v - bv) * (v - bv));
  const cov = aaCov(d, br);
  if (cov < 0.05) return;
  let sh = 0.58 + 0.22 * (1 - clamp01(d / br)); // soft, rounded
  sh += (hash2(Math.floor(u * 2.2) + 3, Math.floor(v * 2.2) + cur.id * 9) - 0.5) * 0.14; // wrinkled skin
  if (v < head + 0.6) sh += 0.06;
  S.stamp(col, row, S.tileKey(palBody, sh), cov * (0.6 + 0.4 * out), z + 0.2);
}

export const snail: AnimalDef = {
  id: 'snail',
  label: 'Snail',
  dot: '#ddb27a',
  baseCount: 11,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'soft',
  palettes: {
    shell: ['#140c06', '#33200f', '#5c3b1c', '#8a5a2b', '#b9824a', '#ddb27a', '#f5dfb5'],
    body: ['#16140f', '#36312a', '#5c5549', '#857c6b', '#ada28c', '#d6ccb4'],
    slime: ['#12171c', '#a9bfcf'],
  },
  lineShade: { slime: 1, body: 0.75 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 60, Math.max(61, world.w - 60));
    e.y = range(rng, 60, Math.max(61, world.h - 60));
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 7, 13);
    e.rate = range(rng, 0.5, 0.8); // creep cycles per second
    e.phase = range(rng, 0, 10);
    e.scale = range(rng, 1.55, 1.95);
    e.seed = range(rng, 0, 1000);
    e.data = { out: 1, hideT: 0 } satisfies SnailData;
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as SnailData;
    d.hideT -= dt;
    const target = d.hideT > 0 ? 0 : 1;
    d.out += (target - d.out) * approach(target ? 0.8 : 9, dt); // snap in, ease out
    // Creep: a pulse of motion each cycle, only when out of the shell.
    e.phase += dt * e.rate * Math.PI * 2;
    const pulse = 0.55 + 0.45 * Math.sin(e.phase);
    const sp = e.speed * pulse * smooth(0.6, 1, d.out);
    e.heading += (vnoise(world.t * 0.08 + e.seed) - 0.5) * 0.9 * dt;
    // Stay inside: turn toward the middle near the edges.
    const m = 70;
    if (e.x < m || e.y < m || e.x > world.w - m || e.y > world.h - m) {
      const toC = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x);
      e.heading += angleDiff(e.heading, toC) * approach(0.6, dt);
    }
    e.vx = Math.cos(e.heading) * sp;
    e.vy = Math.sin(e.heading) * sp;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.drawHeading += angleDiff(e.drawHeading, e.heading) * approach(2, dt);
  },

  onScatter(e) {
    // Hide in the shell instead of running; keep facing the same way.
    const d = e.data as SnailData;
    d.hideT = 2.2 + (e.seed % 1);
    e.heading = e.drawHeading;
  },

  render(e, s, world) {
    S = s;
    cur = e;
    palShell = this.pal.shell;
    palBody = this.pal.body;
    palSlime = this.pal.slime;
    const d = e.data as SnailData;
    out = d.out;
    stretch = Math.sin(e.phase);
    s.forEachCell(e, RADIUS, cellFn);
    if (out > 0.4) {
      // Eye stalks (with eyes at the tips) and short lower tentacles, glyph-only.
      const head = -3.7 * out - 0.4 * stretch;
      const sway = Math.sin(world.t * 1.7 + e.seed) * 0.25;
      for (let side = -1; side <= 1; side += 2) {
        stalk[0] = side * 0.35;
        stalk[1] = head + 0.2;
        stalk[2] = side * (0.6 + sway * side * 0.5);
        stalk[3] = head - 0.8 * out;
        stalk[4] = side * (0.85 + sway * side);
        stalk[5] = head - 1.65 * out;
        s.stampLine(e, stalk, 3, palBody, 0.7, e.z + 0.3, G.o);
        stalk[0] = side * 0.45;
        stalk[1] = head + 0.1;
        stalk[2] = side * 0.85;
        stalk[3] = head - 0.45;
        s.stampLine(e, stalk, 2, palBody, 0.5, e.z + 0.3, G['.']);
      }
    }
    // Slime: a long-lived trail under the foot.
    if (world.trailsOn && out > 0.5) {
      const c = s.cell;
      const k = c * e.scale * 1.2;
      const tx = e.x - Math.cos(e.drawHeading) * k;
      const ty = e.y - Math.sin(e.drawHeading) * k;
      s.trail(Math.floor(tx / c), Math.floor(ty / c), 0.55, palSlime, 9);
    }
  },
};
