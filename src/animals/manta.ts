import type { AnimalDef, Entity, Stamper } from './types';
import { placeAtEdge } from './common';
import { aaCov, capsule, clamp01, ellipse, G, sdCov, sdTriangle, smooth } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise, vnoise2 } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Manta ray: a broad diamond with curved, pointed wings, cephalic "horn" fins at the front and a long
// whip tail; dark back with pale shoulder chevrons; a light wave rolls along the wings as they flap.
// Glides slowly; a click makes it beat harder and glide away.
const RADIUS = 12.2;

let S: Stamper;
let cur: Entity;
let pal = 0;
let span = 1;
let wave = 0;
const tail = new Float32Array(10);

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // Cephalic fins: two short curled lobes in front of the head.
  const dF = capsule(ax, v, 0.85, -2.7, 0.65 + 0.15 * Math.sin(wave * 0.5), -3.9);
  const fc = aaCov(dF, 0.36);
  if (fc > 0.3) {
    S.stamp(col, row, S.tileKey(pal, 0.24), fc, z + 0.5);
    return;
  }

  // Body + wings: a central disc and a rounded triangle per side, squashed by the flap.
  const wx = ax / span;
  const bend = (1 - span) * 1.4 * clamp01(wx / 9); // tips sweep back as they rise
  const vv = v - bend;
  // Wing: leading edge from the head out to a swept-back pointed tip; the trailing edge is scooped
  // (concave) on its way back to the body, which gives the classic manta silhouette.
  let sdW = sdTriangle(wx, vv, 0.5, -2.7, 10.8, 1.9, 0.9, 2.5) - 0.3;
  const scx = 6.4;
  const scy = 5.3;
  const scoop = 3.25 - Math.sqrt((wx - scx) * (wx - scx) + (vv - scy) * (vv - scy));
  if (scoop > sdW) sdW = scoop; // carve the concave trailing edge
  const eb = ellipse(u, v * (v < 0 ? 1.15 : 1), 0, 0.2, 1.9, 3.0, 0); // flat-fronted head and body
  const sd = Math.min(sdW, (eb - 1) * 1.6);
  if (sd > 0.6) return;
  let sh = 0.44;
  sh += 0.12 * (1 - clamp01(wx / 10.8)); // body ridge lighter
  // Leading edge catches light; trailing edge darker.
  sh += 0.1 * smooth(0, -1.6, vv - (-2.7 + (4.6 / 10.3) * wx));
  // Pale shoulder chevrons (like a reef manta).
  if (ellipse(ax, v, 2.3, -0.8, 1.8, 0.55, 0.42) < 1) sh = 0.84;
  // A light band travels out along the wings with each beat.
  sh += 0.1 * Math.sin(wx * 0.9 - wave) * clamp01(wx / 2);
  sh += (vnoise2(u * 0.8 + cur.seed, v * 0.8) - 0.5) * 0.1; // mottling
  sh += (hash2(col * 3, row * 5 + cur.id) - 0.5) * 0.05;
  sh -= 0.3 * smooth(-0.5, 0.3, sd) * sh; // rim
  sh *= 0.78 + 0.22 * span;
  S.stamp(col, row, S.tileKey(pal, sh), sdCov(sd), z);
}

export const manta: AnimalDef = {
  id: 'manta',
  label: 'Manta ray',
  dot: '#7d9fbd',
  baseCount: 4,
  minCount: 2,
  maxCount: 8,
  radius: RADIUS + 6,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    back: ['#04070c', '#0a1420', '#132538', '#1f3a55', '#2f5274', '#4a7194', '#7d9fbd', '#c9dbea'],
  },
  lineShade: { back: 0.75 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    e.x = range(rng, 0, world.w);
    e.y = range(rng, 0, world.h);
    e.heading = range(rng, 0, Math.PI * 2);
    e.speed = range(rng, 24, 42);
    e.rate = range(rng, 0.32, 0.48); // beats per second
    e.phase = range(rng, 0, 10);
    e.scale = range(rng, 1.4, 1.8);
    e.seed = range(rng, 0, 1000);
    if (fromEdge) placeAtEdge(e, world, rng, (RADIUS + 6) * e.scale * world.cell);
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    e.heading += (vnoise(world.t * 0.1 + e.seed) - 0.5) * 0.7 * dt;
    const sp = e.speed * (1 + 2.2 * e.panic);
    const k = approach(0.9, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 1.8 * e.panic);
    if (e.vx * e.vx + e.vy * e.vy > 1) e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(1.6, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    pal = this.pal.back;
    span = 0.84 + 0.16 * Math.cos(e.phase); // from above, the wingtips rising and falling shorten the span only a little
    wave = e.phase;
    s.forEachCell(e, RADIUS, cellFn);
    // Long whip tail, glyph-only, with a slow sway.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      tail[i * 2] = Math.sin(e.phase * 0.5 - t * 2) * 0.6 * t;
      tail[i * 2 + 1] = 2.7 + 5.8 * t;
    }
    s.stampLine(e, tail, 5, pal, 0.75, e.z - 0.1, G['.']);
  },
};
