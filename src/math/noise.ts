/**
 * Tiny value noise, no dependencies. Smooth, deterministic, good enough for wandering.
 * Both functions return roughly [-1, 1].
 */

const hash1 = (i: number): number => {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
};

const hash2 = (x: number, y: number): number => hash1(x + Math.imul(y, 374761393));

// Smoothstep-style fade.
const fade = (t: number): number => t * t * (3 - 2 * t);

/** 1D value noise. */
export function noise1(t: number): number {
  const i = Math.floor(t);
  const f = fade(t - i);
  return hash1(i) * (1 - f) + hash1(i + 1) * f;
}

/** 2D value noise. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const top = a * (1 - fx) + b * fx;
  const bottom = c * (1 - fx) + d * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Two octaves, for slightly richer wandering. */
export const fbm1 = (t: number): number => noise1(t) * 0.7 + noise1(t * 2.17 + 11.3) * 0.3;
