import { describe, expect, it } from 'vitest';
import { hash2, mulberry32 } from '../src/math/rng';
import { vnoise } from '../src/math/noise';
import { angleDiff, len } from '../src/math/vec2';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
  it('hash2 is stable and in [0,1)', () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    expect(hash2(3, 4)).not.toBe(hash2(4, 3));
    expect(hash2(-5, 9)).toBeGreaterThanOrEqual(0);
  });
  it('vnoise is continuous', () => {
    expect(Math.abs(vnoise(1.0) - vnoise(1.001))).toBeLessThan(0.01);
  });
});

describe('vec2', () => {
  it('len and angleDiff', () => {
    expect(len(3, 4)).toBe(5);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });
});
