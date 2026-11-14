import { compileSprite, stampSprite, type CompiledSprite, type Sprite } from '../engine/sampler';
import type { CellBuffer } from '../engine/cellBuffer';
import type { Trails } from '../engine/trails';
import type { World } from '../engine/world';
import { fbm1 } from '../math/noise';
import type { Rng } from '../math/rng';
import { angleDelta, dampAngle } from '../math/vec2';
import { makeEntity, type AnimalDef, type Entity } from './types';

export const butterflySprite: Sprite = {
  facing: -Math.PI / 2,
  palette: {
    a: { color: '#1d4ed8', glyph: '#' },
    b: { color: '#3b82f6', glyph: '+' },
    c: { color: '#93c5fd', glyph: '*' },
    k: { color: '#94a3b8', glyph: ':', alpha: 0.55 },
  },
  frames: [
    [
      // open
      '.....k.k.....',
      '.aab..k..baa.',
      'abbba.k.abbba',
      'abcbbakabbcba',
      '.abba.k.abba.',
      '..a...k...a..',
      '.abba.k.abba.',
      '..aa.....aa..',
    ],
    [
      // half
      '.....k.k.....',
      '..aab.k.baa..',
      '.abbbakabbba.',
      '.abcbakabcba.',
      '..abbakabba..',
      '...a..k..a...',
      '..abb.k.bba..',
      '...aa...aa...',
    ],
    [
      // closed
      '.....k.k.....',
      '....abkba....',
      '...abbkbba...',
      '...abckcba...',
      '....abkba....',
      '....a.k.a....',
      '....abkba....',
      '.....a.a.....',
    ],
  ],
};

interface ButterflyData {
  /** seconds per wing frame */
  flap: number;
  /** preferred cruising speed, px/s */
  cruise: number;
  /** noise stream offset, so each butterfly wanders differently */
  seed: number;
  frame: number;
  frameT: number;
  dir: 1 | -1;
}

let compiled: CompiledSprite | null = null;

const MIN_SPEED = 40;
const MAX_SPEED = 70;

export const butterfly: AnimalDef = {
  id: 'butterfly',
  label: 'Butterfly',
  dot: '#3b82f6',
  baseCount: 26,
  clickMode: 'scatter',
  edge: 'wrap',

  init(world: World): void {
    compiled = compileSprite(butterflySprite, world.palette);
  },

  spawn(world: World, rng: Rng, fromEdge: boolean): Entity {
    const e = makeEntity({
      // Spec §6.3 says 0.8–1.5, but at cellSize 12 that renders much larger than
      // the reference art; this range matches its proportions.
      scale: rng.range(0.6, 1.1),
      phase: rng.range(0, 100),
      heading: rng.range(-Math.PI, Math.PI),
      state: 'fly',
    });
    const speed = rng.range(MIN_SPEED, MAX_SPEED);
    if (fromEdge) {
      world.placeOffEdge(e, rng, compiled ? compiled.radius * e.scale * world.grid.cell : 40);
    } else {
      e.x = rng.range(0, world.grid.width);
      e.y = rng.range(0, world.grid.height);
    }
    e.vx = Math.cos(e.heading) * speed;
    e.vy = Math.sin(e.heading) * speed;
    const data: ButterflyData = {
      flap: rng.range(0.12, 0.2),
      cruise: speed,
      seed: rng.range(0, 1000),
      frame: rng.int(0, 2),
      frameT: 0,
      dir: rng.bool() ? 1 : -1,
    };
    e.data = data;
    return e;
  },

  update(e: Entity, dt: number, _world: World): void {
    const d = e.data as ButterflyData;
    e.phase += dt;

    // Wandering heading: noise turns the butterfly, capped at 2 rad/s.
    const target = e.heading + fbm1(e.phase * 0.5 + d.seed) * 2.2;
    const turn = angleDelta(e.heading, target);
    const maxTurn = 2 * dt;
    const travel = Math.atan2(e.vy, e.vx);
    let dir = travel + Math.max(-maxTurn, Math.min(maxTurn, turn));

    // Panic (after a scatter) temporarily lifts the speed ceiling.
    const maxSpeed = MAX_SPEED * (1 + 2 * e.panic);
    const speed = Math.hypot(e.vx, e.vy);
    const want = e.exiting ? maxSpeed * 3 : Math.min(maxSpeed, Math.max(d.cruise, speed));
    if (e.exiting) dir = e.heading;
    const next = speed + (want - speed) * Math.min(1, dt * 1.5);
    e.vx = Math.cos(dir) * next;
    e.vy = Math.sin(dir) * next;

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    // The sprite turns toward the direction of travel, smoothed.
    if (!e.exiting) e.heading = dampAngle(e.heading, Math.atan2(e.vy, e.vx), 6, dt);

    // Flap. Each butterfly has its own interval, so they don't sync up.
    d.frameT += dt;
    if (d.frameT >= d.flap) {
      d.frameT -= d.flap;
      d.frame += d.dir;
      if (d.frame >= 2) d.dir = -1;
      if (d.frame <= 0) d.dir = 1;
      d.frame = Math.max(0, Math.min(2, d.frame));
    }
  },

  render(e: Entity, buf: CellBuffer, _trails: Trails, world: World): void {
    if (!compiled) return;
    const d = e.data as ButterflyData;
    // Small sideways bob, perpendicular to travel.
    const bob = Math.sin(e.phase * 9) * 2;
    const nx = Math.cos(e.heading + Math.PI / 2) * bob;
    const ny = Math.sin(e.heading + Math.PI / 2) * bob;
    stampSprite(buf, world.grid, compiled, {
      x: e.x + nx,
      y: e.y + ny,
      heading: e.heading,
      scale: e.scale,
      alpha: 0.95 * e.fade,
      depth: Math.round(e.scale * 40),
      frame: d.frame,
    });
  },
};

/** Exposed for tests. */
export const butterflySpriteRadius = (): number => (compiled ? compiled.radius : 0);
