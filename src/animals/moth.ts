import type { AnimalDef, Entity, Stamper } from './types';
import { localToWorld, placeAtEdge } from './common';
import { aaCov, clamp01, ellipse, G, lineGlyph, sdCov, sdTriangle, smooth, type LineGlyph } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise, vnoise2 } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Moths: swept-back triangular forewings over smaller hindwings, dusty brown with wavy cross-lines, a
// dark eye-spot and pale fringes; a thick fuzzy body; feathery antennae. Erratic flight, and when the
// cursor is over the hero they circle it like a lamp.
const RADIUS = 9.4;
const LAMP_R = 460; // px: moths this close to the cursor are drawn to it

let S: Stamper;
let cur: Entity;
let fold = 1;
let palWing = 0;
let palBody = 0;
const P = { x: 0, y: 0 };
const Q = { x: 0, y: 0 };

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // Fuzzy body: thorax + tapering abdomen + head, with ragged edges.
  const bv = v < -1.9 ? -1.9 : v > 3.3 ? 3.3 : v;
  const br = v < 0.4 ? 0.95 : 0.95 - 0.35 * smooth(0.4, 3.3, v);
  const dB = Math.sqrt(u * u + (v - bv) * (v - bv));
  const dH = Math.sqrt(u * u + (v + 2.55) * (v + 2.55));
  const fuzz = (hash2(col * 7 + 3, row * 5 + cur.id) - 0.5) * 0.35;
  const bodyCov = Math.max(aaCov(dB + fuzz, br), aaCov(dH + fuzz, 0.62));
  if (bodyCov > 0.05) {
    let sh = 0.42 + 0.3 * (1 - clamp01(dB / br)) + fuzz * 0.4;
    if (v > 0.6 && (Math.floor(v * 1.4) & 1) === 0) sh -= 0.1; // abdomen rings
    S.stamp(col, row, S.tileKey(palBody, sh), bodyCov, z + 0.5);
    if (bodyCov > 0.6) return;
  }

  // Wings, squashed by the fold. Forewing: a rounded triangle (root, apex, tornus); hindwing: a fan.
  const wx = ax / fold;
  const sdF = sdTriangle(wx, v, 0.7, -1.9, 8.0, -0.9, 4.6, 2.2) - 0.4;
  const eH = ellipse(wx, v, 2.6, 2.3, 2.6, 1.9, 0.6);
  const sdH = (eH - 1) * 1.7;
  const sd = Math.min(sdF, sdH);
  if (sd > 0.6) return;
  const fore = sdF <= sdH;
  const r = Math.sqrt(wx * wx + (v + 0.6) * (v + 0.6)); // distance from the wing root
  let sh = fore ? 0.48 + 0.12 * clamp01(wx / 8) : 0.4;
  if (fore) {
    // Wavy pale cross-lines with a darker band between them, a dark band before the margin and a
    // pale-ringed kidney spot: the classic noctuid pattern.
    const wav = Math.sin(v * 2.0 + cur.seed) * 0.22;
    const rr = r + wav;
    if (rr < 2.3) sh -= 0.12; // dusky base
    if (Math.abs(rr - 2.5) < 0.26 || Math.abs(rr - 5.3) < 0.26) sh = 0.82;
    else if (rr > 2.5 && rr < 5.3) sh += 0.04;
    else if (rr > 5.6 && rr < 6.6) sh -= 0.16;
    const sx = wx - 4.0;
    const sy = v + 0.35;
    const sd2 = sx * sx * 1.4 + sy * sy;
    if (sd2 < 0.5) sh = sd2 < 0.2 ? 0.1 : 0.78;
  } else {
    // Hindwing: plain, darker toward the margin.
    sh += 0.1 * (1 - clamp01(r / 5));
  }
  const e = 1 + sd / 1.2; // ~edge-normalised, for the fringe and rim below
  sh += (vnoise2(wx * 1.1 + cur.seed, v * 1.1) - 0.5) * 0.18; // dusty scales
  if (e > 0.86) sh += 0.14; // pale fringe
  else sh -= 0.25 * smooth(0.6, 0.86, e) * sh;
  sh *= 0.8 + 0.2 * fold;
  S.stamp(col, row, S.tileKey(palWing, sh), sdCov(sd), fore ? z : z - 0.05);
}

/** Feathery antenna: a curved shaft with short barbs on both sides. */
function antenna(e: Entity, side: number): void {
  const c = S.cell;
  const key = S.lineKey(palBody, G['-']);
  let px = 0;
  let py = 0;
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const u = side * (0.35 + 0.9 * t + 0.9 * t * t);
    const v = -2.9 - 2.4 * t;
    localToWorld(e, c, u, v, P);
    if (k > 0) {
      const g = G[lineGlyph(Math.atan2(P.y - py, P.x - px)) as LineGlyph];
      S.stamp(Math.floor(P.x / c), Math.floor(P.y / c), S.lineKey(palBody, k === 6 ? G['.'] : g), 0.9, e.z - 0.2);
      if (k < 6 && k > 1) {
        // Barbs: one cell out on each side of the shaft.
        localToWorld(e, c, u + side * 0.55, v - 0.15, Q);
        S.stamp(Math.floor(Q.x / c), Math.floor(Q.y / c), key, 0.55, e.z - 0.3);
      }
    }
    px = P.x;
    py = P.y;
  }
}

export const moth: AnimalDef = {
  id: 'moth',
  label: 'Moth',
  dot: '#b89a72',
  baseCount: 14,
  maxCount: 30,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    wing: ['#120c07', '#2a1d12', '#4a3522', '#6e5236', '#94754f', '#b89a72', '#d9c3a0', '#f2e6cf'],
    body: ['#15100b', '#2e2318', '#4d3c2b', '#6f5a43', '#8f7a60', '#b4a184'],
  },
  lineShade: { body: 0.95 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 45, 75);
    e.rate = range(rng, 6, 9); // flap Hz: quicker than a butterfly
    e.phase = range(rng, 0, 10);
    e.scale = range(rng, 1.05, 1.85) * world.size;
    e.seed = range(rng, 0, 1000);
    e.stateT = range(rng, 0, Math.PI * 2); // orbit angle around the lamp
    if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const p = world.pointer;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const near = p.active && e.panic < 0.1 && dx * dx + dy * dy < LAMP_R * LAMP_R;
    if (near) {
      // Circle the lamp at a wobbling radius, each moth on its own orbit.
      e.stateT += dt * (1.6 + (e.seed % 1) * 1.2) * (e.id & 1 ? 1 : -1);
      const R = 45 + 35 * vnoise(world.t * 0.7 + e.seed);
      const tx = p.x + Math.cos(e.stateT) * R;
      const ty = p.y + Math.sin(e.stateT) * R;
      const want = Math.atan2(ty - e.y, tx - e.x);
      e.heading += angleDiff(e.heading, want) * approach(5, dt);
    }
    // Erratic flutter.
    e.heading += (vnoise(world.t * 1.1 + e.seed) - 0.5) * (near ? 3 : 5.5) * dt;
    const sp = e.speed * (1 + 2.0 * e.panic) * (near ? 1.3 : 1);
    const k = approach(2.4, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    const jit = Math.sin(e.phase * 0.37) * 16;
    e.x += (e.vx - Math.sin(e.heading) * jit) * dt;
    e.y += (e.vy + Math.cos(e.heading) * jit) * dt;
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 0.6 * e.panic);
    if (e.vx * e.vx + e.vy * e.vy > 1) e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(7, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    palWing = this.pal.wing;
    palBody = this.pal.body;
    fold = 0.5 + 0.5 * Math.pow(Math.abs(Math.cos(e.phase)), 0.6);
    s.forEachCell(e, RADIUS, cellFn);
    antenna(e, -1);
    antenna(e, 1);
  },
};
