import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { capsule, clamp01, ellipse, sdCov, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Bat: membrane wings stretched over visible finger bones, with scalloped trailing edges and a
// moonlit rim (so a dark animal still reads on a dark page); a furry body, pointed ears. Fast, jinking
// flight; between flights it hangs upside-down from the top edge with its wings wrapped. A click
// sends roosting bats off their perch and flying bats scattering.
const RADIUS = 9.8;

// Right-wing skeleton (local cells at full span): shoulder, wrist, three finger tips, leg attachment.
const SH = [0.6, -0.6];
const WR = [3.4, -2.0];
const F1 = [8.6, -1.3];
const F2 = [8.0, 1.9];
const F3 = [5.0, 3.4];
const LG = [1.0, 2.6];
// Polygon around the membrane, in order.
const POLY = [SH, WR, F1, F2, F3, LG];

interface BatData {
  mode: number; // 0 fly, 1 to roost, 2 roost
  roostX: number;
  flyT: number; // s of flight before thinking about roosting
}

let S: Stamper;
let cur: Entity;
let palWing = 0;
let palFur = 0;
let fold = 1;
let roosting = false;

/** Signed distance to the wing membrane polygon (negative inside), with scalloped trailing edges. */
function membrane(x: number, y: number): number {
  let inside = false;
  let dmin = 1e9;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i];
    const [xj, yj] = POLY[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    dmin = Math.min(dmin, capsule(x, y, xi, yi, xj, yj));
  }
  let sd = inside ? -dmin : dmin;
  // Scallops: the membrane sags inward between finger tips (F1→F2, F2→F3, F3→leg).
  for (let i = 2; i < 5; i++) {
    const [ax, ay] = POLY[i];
    const [bx, by] = POLY[i + 1];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.sqrt(ex * ex + ey * ey);
    // Outward normal (polygon is clockwise in screen space, so outward is (ey, -ex)).
    const nx = ey / len;
    const ny = -ex / len;
    const R = len * 0.85;
    const cx = mx + nx * (R - len * 0.17);
    const cy = my + ny * (R - len * 0.17);
    const cut = R - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    if (cut > sd) sd = cut;
  }
  return sd;
}

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);
  // Body, head, ears.
  const eb = ellipse(u, v, 0, 0.35, 0.9, 1.45, 0);
  const eh = ellipse(u, v, 0, -1.45, 0.68, 0.62, 0);
  const ee = ellipse(ax, v, 0.42, -2.15, 0.24, 0.45, -0.25);
  const e = Math.min(eb, eh, ee);
  if (e < 1.12) {
    let sh = 0.52 + 0.24 * (1 - clamp01(e)) + (hash2(col * 5, row * 3 + cur.id) - 0.5) * 0.14; // fur
    if (Math.abs(ax - 0.27) < 0.14 && Math.abs(v + 1.55) < 0.14) sh = 0.95; // eye glint
    S.stamp(col, row, S.tileKey(palFur, sh), softCov(e), z + 0.5);
    if (e < 0.9) return;
  }
  if (roosting) {
    // Wings wrapped around the body: a cloak a little wider than the body.
    const ew = ellipse(u, v, 0, 0.5, 1.35, 2.0, 0);
    if (ew < 1.1) S.stamp(col, row, S.tileKey(palWing, 0.5 + 0.25 * smooth(0.6, 1.0, ew)), softCov(ew), z + 0.2);
    return;
  }
  // Wings, squashed by the flap; tips sweep back as they fold.
  const wx = ax / fold;
  const wy = v - (1 - fold) * 0.9 * clamp01(wx / 7);
  const sd = membrane(wx, wy);
  if (sd > 0.6) return;
  // Bones: arm and three fingers, slightly lighter.
  const db = Math.min(
    capsule(wx, wy, SH[0], SH[1], WR[0], WR[1]),
    capsule(wx, wy, WR[0], WR[1], F1[0], F1[1]),
    capsule(wx, wy, WR[0], WR[1], F2[0], F2[1]),
    capsule(wx, wy, WR[0], WR[1], F3[0], F3[1]),
  );
  let sh = 0.42 + 0.08 * (hash2(col, row * 3 + cur.id) - 0.5);
  if (db < 0.3) sh = 0.66;
  if (sd > -0.5) sh = Math.max(sh, 0.74); // moonlit rim
  sh *= 0.8 + 0.2 * fold;
  S.stamp(col, row, S.tileKey(palWing, sh), sdCov(sd) * (db < 0.28 ? 1 : 0.9), z);
}

function steerInside(e: Entity, world: WorldView, dt: number): void {
  const m = 90;
  if (e.x < m || e.y < m || e.x > world.w - m || e.y > world.h - m) {
    const toC = Math.atan2(world.h / 2 - e.y, world.w / 2 - e.x);
    e.heading += angleDiff(e.heading, toC) * approach(2.2, dt);
  }
}

export const bat: AnimalDef = {
  id: 'bat',
  label: 'Bat',
  dot: '#8a7fa0',
  baseCount: 10,
  maxCount: 20,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'none',
  palettes: {
    wing: ['#07060a', '#151219', '#241f2b', '#352e3f', '#4a4157', '#655a75', '#8a7fa0', '#b9b0cc'],
    fur: ['#0d0a08', '#241c16', '#3e3127', '#5c4a3b', '#7e6754', '#b39a83'],
  },
  pal: {},

  spawn(world, rng) {
    const e = world.newEntity();
    const d: BatData = { mode: rng() < 0.35 ? 2 : 0, roostX: range(rng, 40, Math.max(41, world.w - 40)), flyT: range(rng, 4, 9) };
    e.data = d;
    e.scale = range(rng, 1.35, 1.7);
    e.seed = range(rng, 0, 1000);
    e.speed = range(rng, 85, 135);
    e.rate = range(rng, 6.5, 8.5); // flaps per second
    e.phase = range(rng, 0, 10);
    if (d.mode === 2) {
      e.x = d.roostX;
      e.y = 4 + 2.2 * e.scale * world.cell;
      e.heading = Math.PI / 2; // hanging head-down
      e.stateT = range(rng, 2, 8);
    } else {
      e.x = range(rng, 80, Math.max(81, world.w - 80));
      e.y = range(rng, 80, Math.max(81, world.h - 80));
      e.heading = range(rng, 0, Math.PI * 2);
    }
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as BatData;
    const r = world.rng;
    if (e.panic > 0.05 && d.mode !== 0) d.mode = 0; // startled off the perch
    if (d.mode === 2) {
      // Roosting: hang still, swaying a touch.
      e.vx = 0;
      e.vy = 0;
      e.heading = Math.PI / 2 + Math.sin(world.t * 0.8 + e.seed) * 0.08;
      e.drawHeading = e.heading;
      e.stateT -= dt;
      if (e.stateT <= 0) {
        d.mode = 0; // drop and fly
        d.flyT = range(r, 5, 10);
        e.heading = Math.PI / 2;
      }
      return;
    }
    if (d.mode === 1) {
      // Heading for a roost spot on the top edge.
      const tx = d.roostX - e.x;
      const ty = 4 + 2.2 * e.scale * world.cell - e.y;
      e.heading += angleDiff(e.heading, Math.atan2(ty, tx)) * approach(4, dt);
      if (tx * tx + ty * ty < 18 * 18) {
        d.mode = 2;
        e.stateT = range(r, 3, 9);
        e.x = d.roostX;
        return;
      }
    } else {
      // Erratic hunting flight with sharp jinks.
      e.heading += (vnoise(world.t * 1.6 + e.seed) - 0.5) * 7 * dt;
      steerInside(e, world, dt);
      d.flyT -= dt;
      if (d.flyT <= 0 && e.panic < 0.05) {
        if (r() < 0.45) {
          d.mode = 1;
          d.roostX = range(r, 40, Math.max(41, world.w - 40));
        } else d.flyT = range(r, 3, 7);
      }
    }
    const sp = e.speed * (1 + 1.5 * e.panic);
    const k = approach(4, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.phase += dt * e.rate * Math.PI * 2 * (1 + 0.4 * e.panic);
    e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(9, dt);
  },

  render(e, s) {
    S = s;
    cur = e;
    palWing = this.pal.wing;
    palFur = this.pal.fur;
    const d = e.data as BatData;
    roosting = d.mode === 2;
    fold = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(e.phase)), 0.6);
    s.forEachCell(e, roosting ? 3 : RADIUS, cellFn);
  },
};
