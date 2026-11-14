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

/** What an animal sees while simulating. */
export interface WorldView {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly t: number; // simulated seconds
  readonly rng: Rng;
  readonly entities: readonly Entity[];
  newEntity(): Entity;
}

export interface AnimalDef {
  id: AnimalId;
  label: string;
  dot: string;
  baseCount: number;
  radius: number; // bounding radius, cells at scale 1
  clickMode: 'scatter' | 'feed';
  edge: 'wrap' | 'soft' | 'wrap-vertical';
  palettes: Record<string, string[]>;
  /** Filled at registration: palette name → global palette index. */
  pal: Record<string, number>;
  spawn(world: WorldView, rng: Rng, fromEdge: boolean): Entity;
  update(e: Entity, dt: number, world: WorldView): void;
  render(e: Entity, s: Stamper, world: WorldView): void;
  onScatter?(e: Entity, fromX: number, fromY: number, strength: number): void;
}
