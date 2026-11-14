import { hash2 } from './rng';

/** Smooth 1D value noise in [0, 1]. */
export function vnoise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 17) * (1 - u) + hash2(i + 1, 17) * u;
}
