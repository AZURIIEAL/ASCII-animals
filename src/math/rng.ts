/** Seeded, deterministic RNG (mulberry32). Never use Math.random() in this module. */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [lo, hi) */
  range(lo: number, hi: number): number;
  /** Integer in [lo, hi] */
  int(lo: number, hi: number): number;
  bool(p?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Spawns an independent stream, so per-entity randomness stays reproducible. */
  fork(): Rng;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    bool: (p = 0.5) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    fork: () => mulberry32((next() * 4294967296) >>> 0),
  };
  return rng;
}

/** Picks an item by weight. Weights need not sum to 1. */
export function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
