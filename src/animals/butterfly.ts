import type { AnimalDef, Entity, Stamper } from './types';
import { easeDrawHeading, placeAtEdge } from './common';
import { capsule, clamp01, ellipse, G, sdCov, sdTriangle, smooth } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { approach } from '../math/vec2';

// Butterflies, three real species mixed in one flock:
//  · blue morpho: iridescent blue that shimmers as the wings tilt, a dark base, a black border with
//    white spots;
//  · monarch: orange with black veins, a black border with two rows of white dots, a black wing tip
//    with pale spots;
//  · tiger swallowtail: yellow with black tiger stripes, a black border with yellow crescents, blue and
//    orange spots by the tails, and the tails themselves.
// Proper wing shapes: a pointed forewing with a straight leading edge over a rounded hindwing. A furry
// thorax, segmented abdomen and clubbed antennae. Flight: the hindwings beat a fraction behind the
// forewings, each downstroke surges the body forward, and now and then it stops flapping and glides
// with its wings spread. A click scatters them.
const SPAN = 9.9; // bounding radius, cells

const MORPHO = 0;
const MONARCH = 1;
const SWALLOW = 2;

// Forewing: root, apex, tornus (rounded below). Hindwing: an ellipse; the swallowtail adds a tail.
const FA = [0.45, -1.7];
const FB = [7.5, -5.0];
const FC = [5.5, 0.5];
const FROUND = 0.55;
const HIND = { cx: 3.1, cy: 2.3, rx: 3.3, ry: 2.7, rot: 0.55 };

interface ButterflyData {
  species: number;
  glide: number; // 0 flapping … 1 gliding with wings spread
}

// Per-entity render state, set before forEachCell so the cell callback allocates nothing.
let S: Stamper;
let cur: Entity;
let species = 0;
let foldF = 1; // forewing width factor (1 open … small edge-on)
let foldH = 1; // hindwing lags the forewing a little
let shimmer = 0;
let palBlue = 0;
let palOrange = 0;
let palYellow = 0;
let palInk = 0;
let palWhite = 0;
let palBody = 0;
const antenna = new Float32Array(18);

const fract = (x: number): number => x - Math.floor(x);

/** Is (ax, v) on a radial wing vein (vein spacing ~K per radian from the root)? */
function onVein(ang: number, r: number, K: number, width: number): boolean {
  const a = ang * K;
  return r > 1.3 && (Math.abs(a - Math.round(a)) / K) * r < width;
}

function body(u: number, v: number, col: number, row: number): boolean {
  if (u > 0.95 || u < -0.95 || v < -3.4 || v > 4.6) return false; // far from the body: skip
  const z = cur.z;
  // Head, furry thorax, then a tapering segmented abdomen.
  const eh = ellipse(u, v, 0, -2.75, 0.55, 0.5, 0);
  const et = ellipse(u, v, 0, -1.05, 0.72, 1.15, 0);
  const t = clamp01(v / 4.0);
  const ab = capsule(u, v, 0, 0.2, 0, 4.0) / (0.55 - 0.3 * t);
  const e = Math.min(eh, et, ab);
  if (e >= 1.15) return false;
  let p = palBody;
  let sh = 0.35 + 0.35 * (1 - clamp01(e)) + (hash2(col * 5 + 3, row * 7 + cur.id) - 0.5) * 0.18; // fur
  if (ab <= Math.min(eh, et) && (Math.floor(v * 2.4) & 1) === 0) sh -= 0.12; // abdomen segments
  if (species === MONARCH && e === et && hash2(col * 3, row * 11 + cur.id) > 0.8) {
    p = palWhite; // white dots on a monarch's thorax
    sh = 0.7;
  } else if (species === SWALLOW && ab <= Math.min(eh, et) && Math.abs(u) > 0.18) {
    p = palYellow; // yellow side stripes on the abdomen
    sh = 0.55;
  }
  // Eyes.
  const ex = Math.abs(u) - 0.38;
  const ey = v + 2.85;
  if (ex * ex + ey * ey < 0.05) {
    p = palInk;
    sh = 0.9;
  }
  S.stamp(col, row, S.tileKey(p, sh), sdCov((e - 1) * 1.6), z + 0.5);
  return e < 0.85;
}

function cellFn(u: number, v: number, col: number, row: number): void {
  if (body(u, v, col, row)) return;
  const z = cur.z;
  const au = Math.abs(u);

  // ---- which wing: the forewing lies over the hindwing ----
  const fx = au / foldF;
  const hx = au / foldH;
  // Bounding boxes first: most cells around a butterfly are outside both wings.
  const sdF = fx < 8.7 && v > -6.2 && v < 1.7 ? sdTriangle(fx, v, FA[0], FA[1], FB[0], FB[1], FC[0], FC[1]) - FROUND : 9;
  let sdH = hx < 7.2 && v > -1.2 && v < 6.0 ? (ellipse(hx, v, HIND.cx, HIND.cy, HIND.rx, HIND.ry, HIND.rot) - 1) * 2.6 : 9;
  let tail = false;
  if (species === SWALLOW) {
    const dt = capsule(hx, v, 4.1, 4.3, 4.8, 7.2) - 0.48;
    if (dt < sdH) {
      sdH = dt;
      tail = dt < 0.6; // only cells actually on the tail
    }
  }
  const fore = sdF < 0.25 || sdF <= sdH;
  if (fore) tail = false;
  const sd = fore ? sdF : sdH;
  if (sd > 0.6) return;
  const ax = fore ? fx : hx;
  const fold = fore ? foldF : foldH;
  const depth = -sd; // how far inside the wing edge (cells)
  const dx = ax - 0.5;
  const dy = v + 0.6;
  const r = Math.sqrt(dx * dx + dy * dy); // from the wing root
  const ang = Math.atan2(dy, dx);

  let p = palInk;
  let sh = 0.4;
  if (species === MORPHO) {
    // Iridescent blue, brightest mid-wing, shimmering as the wing tilts; dark blue-black at the base.
    p = palBlue;
    sh = 0.5 + 0.25 * smooth(0.8, 4.0, r) + 0.18 * shimmer + Math.sin(ax * 0.9 + v * 0.7 + cur.seed) * 0.05;
    if (r < 1.5) sh = 0.22 + 0.2 * smooth(0.6, 1.5, r);
    if (onVein(ang, r, 5.2, 0.13)) sh -= 0.1;
    const bw = fore ? 0.85 : 0.7;
    if (depth < bw) {
      p = palInk;
      sh = 0.62;
      if (depth > 0.25 && depth < bw - 0.1 && fract(ang * 3.4 + 0.5) < 0.3) {
        p = palWhite;
        sh = 0.8; // white spots in the border
      }
    }
    if (fore) {
      const sx = ax - 6.0;
      const sy = v + 3.7;
      if (sx * sx + sy * sy < 0.32) {
        p = palWhite;
        sh = 0.9; // apical spot
      }
    }
  } else if (species === MONARCH) {
    p = palOrange;
    sh = 0.64 + 0.12 * smooth(1.0, 4.0, r) + (fore ? 0 : 0.05);
    if (onVein(ang, r, 4.0, 0.12)) {
      p = palInk;
      sh = 0.55; // black veins
    }
    let black = depth < 0.65;
    // Black wing tip with a band of pale spots.
    if (fore) {
      const tx = ax - FB[0];
      const ty = v - FB[1];
      if (tx * tx + ty * ty < 1.8 * 1.8) black = true;
    }
    if (black) {
      p = palInk;
      sh = 0.62;
      // Two rows of white dots in the border, and pale spots in the tip.
      if (depth > 0.2 && depth < 0.5) {
        if (fract(ang * 4.2 + (depth > 0.5 ? 0.5 : 0)) < 0.3) {
          p = palWhite;
          sh = 0.85;
        }
      }
      if (fore) {
        for (let i = 0; i < 4; i++) {
          const sx = ax - (5.0 + 0.55 * i);
          const sy = v - (-3.0 - 0.45 * i);
          if (sx * sx + sy * sy < 0.13) {
            p = i < 2 ? palOrange : palWhite;
            sh = i < 2 ? 0.8 : 0.9;
          }
        }
      }
    }
  } else {
    // Tiger swallowtail.
    p = palYellow;
    sh = 0.62 + 0.08 * smooth(1, 4, r);
    const st = ax * 0.92 - v * 0.42; // stripe coordinate across the wings
    const stripe = (st > 0.8 && st < 1.35) || (fore && ((st > 2.8 && st < 3.2) || (st > 4.4 && st < 4.75)));
    if (stripe || r < 0.8) {
      p = palInk;
      sh = 0.62;
    }
    if (onVein(ang, r, 5, 0.1)) sh -= 0.08;
    const bw = fore ? 0.85 : 1.05;
    if (tail || depth < bw) {
      p = palInk;
      sh = 0.62;
      if (!tail && depth > 0.25 && depth < 0.6 && fract(ang * 3.8) < 0.5) {
        p = palYellow;
        sh = 0.6; // yellow crescents
      }
      if (!fore && !tail && depth > 0.65 && fract(ang * 3.8) < 0.4 && ang > 0.2) {
        p = palBlue;
        sh = 0.6; // blue spots near the tail
      }
    }
    if (!fore) {
      const ox = ax - 1.25;
      const oy = v - 4.7;
      if (ox * ox + oy * oy < 0.3) {
        p = palOrange;
        sh = 0.7; // orange eyespot by the inner edge
      }
    }
  }
  sh += (hash2(col * 3 + (u < 0 ? 97 : 0), row * 5 + cur.id * 31) - 0.5) * 0.06; // scale texture
  sh -= 0.3 * smooth(-0.35, 0.2, sd) * sh; // rim
  sh *= 0.62 + 0.38 * fold; // tilted wings catch less light
  S.stamp(col, row, S.tileKey(p, sh), sdCov(sd), fore ? z : z - 0.05);
}

export const butterfly: AnimalDef = {
  id: 'butterfly',
  label: 'Butterfly',
  dot: '#449ad9',
  baseCount: 20,
  radius: SPAN,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    wing: ['#06101e', '#0c2443', '#17497e', '#2a75b8', '#449ad9', '#6cb7ec', '#a3d6f7', '#eef8ff'],
    orange: ['#1a0a02', '#4a1d04', '#8a3a06', '#c85a0a', '#ec7d12', '#f8a23a', '#ffc874', '#ffe9c4'],
    yellow: ['#1a1604', '#4a3f08', '#8c7810', '#d4b418', '#f4d43a', '#fbe67a', '#fff4bc', '#fffbe8'],
    ink: ['#0a0a0d', '#17171c', '#24242b', '#33333d', '#454552', '#5c5c6c'],
    white: ['#2a2a2e', '#8a8a90', '#d8d8dc', '#f4f4f6', '#ffffff'],
    body: ['#141210', '#2a2420', '#3e352e', '#584b40', '#776656', '#9a8670'],
  },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    const roll = rng();
    const d: ButterflyData = { species: roll < 0.45 ? MORPHO : roll < 0.75 ? MONARCH : SWALLOW, glide: 0 };
    e.data = d;
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 36, 62) * (d.species === MONARCH ? 1.15 : 1);
    e.phase = range(rng, 0, 10);
    e.rate = range(rng, 3.4, 4.8);
    e.scale = range(rng, 0.9, 1.55);
    e.seed = range(rng, 0, 1000);
    if (fromEdge) placeAtEdge(e, world, rng, SPAN * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as ButterflyData;
    // Now and then stop flapping and glide on spread wings (never while panicking).
    const wantGlide = e.panic < 0.05 && vnoise(world.t * 0.22 + e.seed * 3.1) > 0.64 ? 1 : 0;
    d.glide += (wantGlide - d.glide) * approach(3, dt);
    e.heading += (vnoise(world.t * 0.4 + e.seed) - 0.5) * 3.4 * dt * (1 - 0.6 * d.glide); // smooth wander
    // Each downstroke surges the body forward a little.
    const stroke = 1 + 0.35 * Math.max(0, Math.sin(e.phase)) * (1 - d.glide);
    const sp = e.speed * (1 + 2.2 * e.panic) * stroke;
    const k = approach(1.8, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    const bob = Math.sin(e.phase * 0.5) * 12 * (1 - d.glide); // fluttery side-to-side
    e.x += (e.vx - Math.sin(e.heading) * bob) * dt;
    e.y += (e.vy + Math.cos(e.heading) * bob) * dt;
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 0.9 * e.panic) * (1 - 0.88 * d.glide);
    easeDrawHeading(e, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    const d = e.data as ButterflyData;
    species = d.species;
    palBlue = this.pal.wing;
    palOrange = this.pal.orange;
    palYellow = this.pal.yellow;
    palInk = this.pal.ink;
    palWhite = this.pal.white;
    palBody = this.pal.body;
    // Wings fold toward the viewer: width 100% → ~16%. sqrt keeps them open longer; gliding holds them open.
    const flap = (ph: number): number => 0.16 + 0.84 * Math.sqrt(Math.abs(Math.cos(ph)));
    foldF = flap(e.phase) * (1 - d.glide) + 0.97 * d.glide;
    foldH = flap(e.phase - 0.35) * (1 - d.glide) + 0.97 * d.glide;
    shimmer = Math.sin(e.phase * 0.5 + e.seed) * 0.5 + (foldF - 0.6);
    s.forEachCell(e, SPAN, cellFn);

    // Antennae: glyph-only, curving out, with clubbed tips.
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 9; k++) {
        const t = k / 8;
        antenna[k * 2] = side * (0.25 + 0.6 * t + 1.3 * t * t);
        antenna[k * 2 + 1] = -3.2 - 3.4 * t;
      }
      s.stampLine(e, antenna, 9, palBody, 0.8, e.z - 0.2, G.o);
    }
  },
};
