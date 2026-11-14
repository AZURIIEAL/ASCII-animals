import type { AnimalId } from '../types';
import type { Rng } from '../math/rng';

export interface Entity {
  id: number;
  z: number; // random 0..1, stamp priority
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  drawHeading: number; // smooths toward the velocity direction
  scale: number;
  phase: number;
  state: string;
  stateT: number;
  panic: number;
  seed: number;
  speed: number; // base speed, px/s
  rate: number; // base cycle rate (flap Hz, gait Hz, …)
  exiting?: boolean;
  data?: unknown;
}

/** Called per cell inside an entity's bounding circle with local (u, v) in cells at scale 1. */
export type CellFn = (u: number, v: number, col: number, row: number) => void;

/** What an animal sees while rendering. Implemented by the World. */
export interface Stamper {
  readonly cell: number;
  stamp(col: number, row: number, key: number, alpha: number, pri: number): void;
  tileKey(pal: number, shade: number): number;
  lineKey(pal: number, glyph: number): number;
  forEachCell(e: Entity, radius: number, fn: CellFn): void;
  /** Glyph-only polyline. `pts` holds n (u, v) pairs in local space. First point '.', last `tip`. */
  stampLine(e: Entity, pts: ArrayLike<number>, n: number, pal: number, alpha: number, pri: number, tip: number): void;
  trail(col: number, row: number, value: number, pal: number, tau: number): void;
}

export interface Pellet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number; // age, s
  life: number; // s
  kind: 0 | 1; // 0 = food pellet (koi), 1 = crumb (ants)
}

export interface Pointer {
  x: number;
  y: number;
  active: boolean; // false when the pointer is outside the host
}

/** What an animal sees while simulating. */
export interface WorldView {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly t: number; // simulated seconds
  readonly rng: Rng;
  readonly entities: readonly Entity[];
  readonly pellets: readonly Pellet[];
  readonly trailsOn: boolean;
  readonly pointer: Pointer;
  /** Palette index for crumb tiles. */
  readonly crumbPal: number;
  newEntity(): Entity;
  /** Remove pellet i (eaten) and leave a small ripple ring. */
  eatPellet(i: number): void;
  /** Remove pellet i silently (picked up) and return it. */
  takePellet(i: number): Pellet | undefined;
  addPellet(x: number, y: number, life: number, kind: 0 | 1): void;
  ripple(x: number, y: number, R: number, pal: number, life?: number): void;
}

export interface AnimalDef {
  id: AnimalId;
  label: string;
  dot: string;
  baseCount: number;
  radius: number; // bounding radius, cells at scale 1
  /** scatter: nearby animals flee · feed: drop pellets · custom: `onClick` handles it. */
  clickMode: 'scatter' | 'feed' | 'custom';
  /** Count clamp (default [4, 80]); e.g. one whale. */
  minCount?: number;
  maxCount?: number;
  /** none: the animal keeps itself inside the host. */
  edge: 'wrap' | 'soft' | 'wrap-vertical' | 'none';
  palettes: Record<string, string[]>;
  /** Optional ramp position for each palette's glyph-only cells (default 0.7). */
  lineShade?: Record<string, number>;
  /** Filled at registration: palette name → global palette index. */
  pal: Record<string, number>;
  spawn(world: WorldView, rng: Rng, fromEdge: boolean): Entity;
  update(e: Entity, dt: number, world: WorldView): void;
  render(e: Entity, s: Stamper, world: WorldView): void;
  onScatter?(e: Entity, fromX: number, fromY: number, strength: number): void;
  /** clickMode 'custom': handle a click at (x, y) in host px. */
  onClick?(world: WorldView, x: number, y: number): void;
}
