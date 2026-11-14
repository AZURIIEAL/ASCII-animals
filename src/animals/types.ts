import type { Vec2 } from '../math/vec2';
import type { Rng } from '../math/rng';
import type { CellBuffer } from '../engine/cellBuffer';
import type { Trails } from '../engine/trails';
import type { AnimalId } from '../types';
import type { World } from '../engine/world';

export interface Entity {
  /** px, host-local */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** radians */
  heading: number;
  scale: number;
  /** animation clock */
  phase: number;
  /** per-animal state machine */
  state: string;
  /** time left in state */
  stateT: number;
  /** 0..1, decays; raises max speed after a scatter */
  panic: number;
  /** set during an animal switch */
  exiting?: boolean;
  /** time spent exiting, seconds */
  exitT?: number;
  /** alpha multiplier, used by the switch transition */
  fade: number;
  /** per-animal extras (spine, tentacles, variant…) */
  data?: unknown;
}

export interface AnimalDef {
  id: AnimalId;
  label: string;
  dot: string;
  baseCount: number;
  clickMode: 'scatter' | 'feed';
  edge: 'wrap' | 'soft' | 'wrap-vertical';
  /** Registers sprites and colours once the palette exists. */
  init?(world: World): void;
  spawn(world: World, rng: Rng, fromEdge: boolean): Entity;
  update(e: Entity, dt: number, world: World): void;
  render(e: Entity, buf: CellBuffer, trails: Trails, world: World): void;
  onScatter?(e: Entity, from: Vec2, strength: number): void;
}

export function makeEntity(partial: Partial<Entity> = {}): Entity {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: 0,
    scale: 1,
    phase: 0,
    state: 'idle',
    stateT: 0,
    panic: 0,
    fade: 1,
    ...partial,
  };
}
