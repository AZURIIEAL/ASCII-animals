import type { AnimalDef, Entity, Stamper, WorldView } from './types';
import { placeAtEdge } from './common';
import { aaCov, capsule, clamp01, ellipse, G, smooth, softCov } from '../engine/shapes';
import { hash2, range } from '../math/rng';
import { vnoise } from '../math/noise';
import { angleDiff, approach } from '../math/vec2';

// Spec §7.6 / §9.6, modelled on a red-crowned crane so it reads at a glance: white wings with a
// black trailing edge and black fingered primaries, black neck, white head with a red crown,
// long beak and trailing legs. Loose V flocks.
const RADIUS = 10.8;
const MAX_TURN = 0.4; // rad/s for leaders
const W0 = 0.7; // wing root (cells from the spine)
const W1 = 10.0; // wing tip
const PRIM = 7.6; // primaries (black fingers) start here

interface CraneData {
  leader: Entity | null; // null = flock leader
  slot: number; // 1, 2, 3 behind the leader, alternating sides
  span: number; // wing span factor, rendered
  flapping: boolean;
  cycle: number; // flap cycle length, s
  left: number; // flock slots still open (leaders only)
}

let S: Stamper;
let cur: Entity;
let span = 1;
let palWhite = 0;
let palTip = 0;
let palCrown = 0;
const beak = new Float32Array(8);
const leg = new Float32Array(10);

function cellFn(u: number, v: number, col: number, row: number): void {
  const z = cur.z;
  const ax = Math.abs(u);

  // ---- head, neck, body, tail ----
  const dHead = Math.sqrt(u * u + (v + 6.05) * (v + 6.05));
  const dNeck = capsule(u, v, 0, -1.6, 0, -5.6);
  const eb = ellipse(u, v, 0, 0.4, 1.15, 2.5, 0);
  const et = ellipse(u, v, 0, 2.9, 0.9, 0.95, 0);
  const cHead = aaCov(dHead, 0.66);
  const cNeck = aaCov(dNeck, 0.42);
  const cBody = softCov(eb);
  const cTail = softCov(et);
  const cov = Math.max(cHead, cNeck, cBody, cTail);
  if (cov > 0.04) {
    let pal = palWhite;
    let sh: number;
    let pri = z + 0.5;
    if (cHead >= cov - 1e-6) {
      sh = 0.9;
      const cy = v + 6.2;
      if (u * u + cy * cy < 0.14) {
        pal = palCrown; // red crown
        sh = 0.6;
      }
      pri = z + 0.6;
    } else if (cNeck >= cov - 1e-6) {
      pal = palTip; // black neck
      sh = 0.55 + 0.35 * (1 - clamp01(dNeck / 0.5));
      pri = z + 0.55;
    } else if (cTail > cBody) {
      pal = palTip; // black bustle (tertials)
      sh = 0.45 + 0.3 * (1 - clamp01(et));
    } else {
      sh = 0.72 + 0.2 * (1 - clamp01(eb)) - 0.25 * smooth(0.7, 1.0, eb);
    }
    S.stamp(col, row, S.tileKey(pal, sh), cov, pri);
    if (cov > 0.6) return;
  }

  // ---- wings: a rounded-rectangle profile, squashed by the flap ----
  const wx = ax / span;
  if (wx < W0 - 0.4 || wx > W1 + 0.8) return;
  const t = clamp01((wx - W0) / (W1 - W0));
  const half = 2.0 - 0.55 * t; // chord half-width: broad at the root, narrower at the tip
  const mid = 0.1 - 0.5 * t + 0.3 * Math.max(0, wx - 5.0) * (0.6 + 0.4 * span); // hand swept back at the wrist
  const dv = v - mid;
  const ex = (wx - (W0 + W1) / 2) / ((W1 - W0) / 2);
  const ey = dv / half;
  const e = Math.sqrt(ex * ex * ex * ex + ey * ey);
  const fingers = wx > PRIM;
  // Primaries: separate fingers along the trailing half, poking past the tip.
  if (fingers && ey > -0.35) {
    const f = (wx - PRIM) * 1.45;
    if (f - Math.floor(f) > 0.62) return; // gap between fingers
  }
  const limit = fingers && ey > -0.35 ? 1.18 : 1.1;
  if (e >= limit) return;
  const black = fingers || ey > 0.42; // black primaries and trailing edge (secondaries)
  let sh: number;
  if (black) {
    sh = 0.62 - 0.2 * clamp01((ey - 0.42) / 0.6) + (fingers ? 0.08 : 0);
  } else {
    sh = 0.93 - 0.18 * clamp01((ey + 1) / 1.4); // leading edge brightest
    if (ey > -0.1 && (Math.floor(wx * 1.25) & 1) === 0) sh -= 0.06; // feather rows
    sh -= 0.3 * smooth(0.82, 1.05, e) * sh;
  }
  sh += (hash2(Math.floor(wx * 1.6) + (u < 0 ? 51 : 0), Math.floor(v * 1.6) + cur.id * 23) - 0.5) * 0.06;
  sh *= 0.75 + 0.25 * span; // seen edge-on mid-flap
  S.stamp(col, row, S.tileKey(black ? palTip : palWhite, sh), softCov(e, 0.85, limit), z);
}

function steerLeader(e: Entity, dt: number, world: WorldView): void {
  const target = e.heading + (vnoise(world.t * 0.2 + e.seed) - 0.5) * 2.0;
  const d = angleDiff(e.heading, target);
  const maxTurn = MAX_TURN * (1 + 3 * e.panic) * dt;
  e.heading += Math.max(-maxTurn, Math.min(maxTurn, d * dt * 2));
}

function steerFollower(e: Entity, L: Entity, d: CraneData, dt: number, world: WorldView): void {
  // Slot: behind the leader, alternating sides (a loose V).
  const k = Math.ceil(d.slot / 2);
  const side = d.slot % 2 ? -1 : 1;
  const dist = 52 * k * L.scale;
  const fx = Math.cos(L.heading);
  const fy = Math.sin(L.heading);
  let tx = L.x - fx * dist - fy * side * dist * 0.8;
  let ty = L.y - fy * dist + fx * side * dist * 0.8;
  // Wrap-aware: aim for the nearest copy of the slot.
  const mw = world.w + 2 * RADIUS * e.scale * world.cell;
  const mh = world.h + 2 * RADIUS * e.scale * world.cell;
  if (tx - e.x > mw / 2) tx -= mw;
  else if (e.x - tx > mw / 2) tx += mw;
  if (ty - e.y > mh / 2) ty -= mh;
  else if (e.y - ty > mh / 2) ty += mh;
  const dx = tx - e.x;
  const dy = ty - e.y;
  const gap = Math.sqrt(dx * dx + dy * dy);
  // Head toward the slot when far, match the leader's heading when close.
  const want = gap > 25 ? Math.atan2(dy, dx) : L.heading;
  const maxTurn = 1.0 * (1 + 3 * e.panic) * dt;
  e.heading += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(e.heading, want) * dt * 3));
  e.speed = L.speed * (1 + clamp01((gap - 10) / 120) * 0.5);
}

export const crane: AnimalDef = {
  id: 'crane',
  label: 'Crane',
  dot: '#eef1f6',
  baseCount: 10,
  radius: RADIUS,
  clickMode: 'scatter',
  edge: 'wrap',
  palettes: {
    white: ['#16181d', '#3a3f4a', '#7d8494', '#c4c9d4', '#eef1f6', '#ffffff'],
    // Slate rather than the spec's near-black: true black vanishes on the #0a0a0c background.
    tip: ['#121419', '#262a33', '#3b414d', '#555d6b', '#727b8b', '#9aa3b2'],
    crown: ['#ef4444', '#ef4444'],
  },
  lineShade: { white: 0.75, tip: 0.9 },
  pal: {},

  spawn(world, rng, fromEdge) {
    const e = world.newEntity();
    // Join an existing flock that still has room, otherwise start a new one (2–4 birds).
    let leader: Entity | null = null;
    for (let i = world.entities.length - 1; i >= 0; i--) {
      const o = world.entities[i];
      const od = o.data as CraneData;
      if (!o.exiting && od.leader === null && od.left > 0) {
        leader = o;
        break;
      }
    }
    const data: CraneData = { leader, slot: 0, span: 1, flapping: false, cycle: range(rng, 0.6, 0.9), left: 0 };
    e.data = data;
    e.scale = range(rng, 0.8, 1.4);
    e.seed = range(rng, 0, 1000);
    e.state = 'glide';
    e.stateT = range(rng, 1, 3);
    if (leader) {
      const ld = leader.data as CraneData;
      data.slot = (leader.rate | 0) - ld.left + 1;
      ld.left--;
      e.heading = leader.heading;
      e.speed = leader.speed;
      const k = Math.ceil(data.slot / 2);
      const side = data.slot % 2 ? -1 : 1;
      const fx = Math.cos(e.heading);
      const fy = Math.sin(e.heading);
      const dist = 52 * k * leader.scale;
      e.x = leader.x - fx * dist - fy * side * dist * 0.8 + range(rng, -10, 10);
      e.y = leader.y - fy * dist + fx * side * dist * 0.8 + range(rng, -10, 10);
      e.scale = leader.scale * range(rng, 0.9, 1.0);
      e.phase = leader.phase + range(rng, 0.5, 2);
    } else {
      e.x = range(rng, 0, world.w);
      e.y = range(rng, 0, world.h);
      e.heading = range(rng, 0, Math.PI * 2);
      e.speed = range(rng, 70, 110);
      data.left = 1 + Math.floor(rng() * 3); // followers: 1–3
      e.rate = data.left; // flock size − 1, to number the slots
      if (fromEdge) placeAtEdge(e, world, rng, RADIUS * e.scale * world.cell);
    }
    e.vx = Math.cos(e.heading) * e.speed;
    e.vy = Math.sin(e.heading) * e.speed;
    e.drawHeading = e.heading;
    return e;
  },

  update(e, dt, world) {
    const d = e.data as CraneData;
    if (d.leader && (d.leader.exiting || world.entities.indexOf(d.leader) < 0)) d.leader = null; // flock broke up
    if (d.leader) steerFollower(e, d.leader, d, dt, world);
    else steerLeader(e, dt, world);

    const sp = e.speed * (1 + 1.5 * e.panic);
    const k = approach(1.5, dt);
    e.vx += (Math.cos(e.heading) * sp - e.vx) * k;
    e.vy += (Math.sin(e.heading) * sp - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(4, dt);

    // Wing cycle: glide 1–3 s, flap 1–2 s; panicked birds flap fast (0.25 s).
    e.stateT -= dt;
    if (e.state === 'glide') {
      if (e.stateT <= 0 || e.panic > 0.05) {
        e.state = 'flap';
        e.stateT = range(world.rng, 1, 2);
        e.phase = 0;
      }
    } else {
      const cycle = e.panic > 0.05 ? 0.25 : d.cycle;
      const before = Math.floor(e.phase / (Math.PI * 2));
      e.phase += (dt / cycle) * Math.PI * 2;
      const after = Math.floor(e.phase / (Math.PI * 2));
      // End the flap only at the top of a beat, so the wings never pop.
      if (e.stateT <= 0 && e.panic <= 0.05 && after > before) {
        e.state = 'glide';
        e.stateT = range(world.rng, 1, 3);
        e.phase = 0;
      }
    }
    d.span = e.state === 'flap' ? 0.55 + 0.45 * Math.cos(e.phase) : 1;
  },

  render(e, s) {
    S = s;
    cur = e;
    const d = e.data as CraneData;
    span = d.span;
    palWhite = this.pal.white;
    palTip = this.pal.tip;
    palCrown = this.pal.crown;
    s.forEachCell(e, RADIUS, cellFn);
    // Beak and trailing legs are glyph-only.
    for (let i = 0; i < 4; i++) {
      beak[i * 2] = 0;
      beak[i * 2 + 1] = -6.7 - 0.65 * i;
    }
    s.stampLine(e, beak, 4, palWhite, 0.75, e.z + 0.6, G['.']);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        leg[i * 2] = side * (0.28 + 0.12 * t);
        leg[i * 2 + 1] = 3.5 + 4.0 * t;
      }
      s.stampLine(e, leg, 5, palTip, 0.6, e.z - 0.2, G['.']);
    }
  },
};
