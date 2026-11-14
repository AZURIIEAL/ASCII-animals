/** Tiny allocation-free 2D helpers (plain numbers, no objects). */
export const len = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** Shortest signed angle from a to b, in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  const d = b - a;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** Exponential approach factor for rate `k` per second over `dt`. */
export const approach = (k: number, dt: number): number => 1 - Math.exp(-dt * k);
