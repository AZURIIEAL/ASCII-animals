import type { Entity, WorldView } from './types';
import { range, type Rng } from '../math/rng';
import { angleDiff, approach } from '../math/vec2';

/** drawHeading eases toward the velocity direction at `rate` per second. */
export function easeDrawHeading(e: Entity, dt: number, rate = 6): void {
  if (e.vx * e.vx + e.vy * e.vy < 1e-4) return;
  e.drawHeading += angleDiff(e.drawHeading, Math.atan2(e.vy, e.vx)) * approach(rate, dt);
}

/** Position and inward heading for an entity entering from just outside a random edge. */
export function placeAtEdge(e: Entity, world: WorldView, rng: Rng, margin: number): void {
  const side = (rng() * 4) | 0;
  const { w, h } = world;
  if (side === 0) {
    e.x = -margin;
    e.y = range(rng, 0, h);
  } else if (side === 1) {
    e.x = w + margin;
    e.y = range(rng, 0, h);
  } else if (side === 2) {
    e.x = range(rng, 0, w);
    e.y = -margin;
  } else {
    e.x = range(rng, 0, w);
    e.y = h + margin;
  }
  // Aim at a random point in the middle half of the host.
  const tx = range(rng, w * 0.25, w * 0.75);
  const ty = range(rng, h * 0.25, h * 0.75);
  e.heading = Math.atan2(ty - e.y, tx - e.x);
  e.drawHeading = e.heading;
}
