import type { Entity, Stamper, WorldView } from './types';
import { aaCov } from '../engine/shapes';
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

/**
 * Tile key for a splatted cell: t = position along the segment (0..1), dn = signed lateral distance / radius
 * (−1 one edge … 0 centre … 1 the other edge), so patterns can differ by side.
 */
export type SplatKey = (t: number, dn: number, col: number, row: number) => number;

/**
 * Rasterise a tapered capsule given in world px (radii in px) straight into the stamper. Used for long,
 * bending parts (snake bodies, octopus arms) where searching every segment per cell would be too slow.
 * Overlapping joints resolve by coverage, so the body stays continuous.
 */
export function splatCapsule(
  S: Stamper,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ra: number,
  rb: number,
  pri: number,
  key: SplatKey,
  alphaMul = 1,
): void {
  const c = S.cell;
  const rm = Math.max(ra, rb) + c * 0.6;
  const c0 = Math.floor((Math.min(ax, bx) - rm) / c);
  const c1 = Math.floor((Math.max(ax, bx) + rm) / c);
  const r0 = Math.floor((Math.min(ay, by) - rm) / c);
  const r1 = Math.floor((Math.max(ay, by) + rm) / c);
  const sx = bx - ax;
  const sy = by - ay;
  const ll = sx * sx + sy * sy || 1;
  for (let row = r0; row <= r1; row++) {
    const py = (row + 0.5) * c - ay;
    for (let col = c0; col <= c1; col++) {
      const px = (col + 0.5) * c - ax;
      let t = (px * sx + py * sy) / ll;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - sx * t;
      const dy = py - sy * t;
      const d = Math.sqrt(dx * dx + dy * dy);
      const r = ra + (rb - ra) * t;
      const cov = aaCov(d / c, r / c);
      if (cov < 0.04) continue;
      const side = dx * -sy + dy * sx < 0 ? -1 : 1;
      S.stamp(col, row, key(t, (side * d) / r, col, row), cov * alphaMul, pri + cov * 0.01); // coverage wins overlaps
    }
  }
}

/** Local (u, v) → world px for an entity. Writes into `out`. */
export function localToWorld(e: Entity, cell: number, u: number, v: number, out: { x: number; y: number }): void {
  const k = cell * e.scale;
  const fx = Math.cos(e.drawHeading);
  const fy = Math.sin(e.drawHeading);
  out.x = e.x + (u * -fy - v * fx) * k;
  out.y = e.y + (u * fx - v * fy) * k;
}
