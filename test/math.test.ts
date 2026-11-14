import { describe, expect, it } from 'vitest';
import { angleDelta, dist, limit, normalize, vec2 } from '../src/math/vec2';
import { mulberry32, weighted } from '../src/math/rng';

describe('vec2', () => {
  it('normalizes to unit length and leaves the zero vector alone', () => {
    const out = vec2();
    normalize(out, vec2(3, 4));
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
    normalize(out, vec2(0, 0));
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('measures distance', () => {
    expect(dist(vec2(0, 0), vec2(3, 4))).toBe(5);
  });

  it('limits length without changing direction', () => {
    const v = vec2(30, 40);
    limit(v, 10);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(10);
    expect(v.y / v.x).toBeCloseTo(4 / 3);
  });

  it('takes the short way round for angles', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6);
  });
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds and stays inside [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toBe(b.next());
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('respects int bounds and weights', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 200; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
    const counts = { a: 0, b: 0 };
    const r2 = mulberry32(11);
    for (let i = 0; i < 1000; i++) counts[weighted(r2, ['a', 'b'] as const, [9, 1])]++;
    expect(counts.a).toBeGreaterThan(counts.b * 4);
  });
});
