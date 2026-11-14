import { describe, expect, it } from 'vitest';
import { capsule, ellipse, lineGlyph, smooth, softCov, toLocal } from '../src/engine/shapes';

describe('shape fields', () => {
  it('ellipse is <1 inside, 1 on the edge', () => {
    expect(ellipse(0, 0, 0, 0, 2, 1)).toBe(0);
    expect(ellipse(2, 0, 0, 0, 2, 1)).toBeCloseTo(1);
    expect(ellipse(0, 1, 0, 0, 2, 1)).toBeCloseTo(1);
    // rotated 90°: the long axis now points along y
    expect(ellipse(0, 2, 0, 0, 2, 1, Math.PI / 2)).toBeCloseTo(1);
  });
  it('capsule is distance to a segment', () => {
    expect(capsule(1, 1, 0, 0, 2, 0)).toBeCloseTo(1);
    expect(capsule(-3, 0, 0, 0, 2, 0)).toBeCloseTo(3);
    expect(capsule(5, 4, 2, 0, 2, 0)).toBeCloseTo(5);
  });
  it('smooth works both ways and softCov fades across the edge', () => {
    expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smooth(1, 0, 0.25)).toBeCloseTo(smooth(0, 1, 0.75));
    expect(softCov(0.5)).toBe(1);
    expect(softCov(1.2)).toBe(0);
    const mid = softCov(1.0);
    expect(mid > 0 && mid < 1).toBe(true);
  });
  it('lineGlyph maps screen angles', () => {
    expect(lineGlyph(0)).toBe('-');
    expect(lineGlyph(Math.PI)).toBe('-');
    expect(lineGlyph(Math.PI / 2)).toBe('|');
    expect(lineGlyph(Math.PI / 4)).toBe('\\'); // y down: +x,+y is down-right
    expect(lineGlyph(-Math.PI / 4)).toBe('/');
  });
});

describe('local-space transform', () => {
  it('a point 2 cells ahead of heading 0 has v = -2, u = 0', () => {
    const o = { u: 0, v: 0 };
    toLocal(18, 0, 0, 9, 1, o);
    expect(o.v).toBeCloseTo(-2);
    expect(o.u).toBeCloseTo(0);
  });
  it('right is +u and scale divides', () => {
    const o = { u: 0, v: 0 };
    toLocal(0, 18, 0, 9, 2, o); // heading 0 = +x, so right is +y (screen down)
    expect(o.u).toBeCloseTo(1);
    expect(o.v).toBeCloseTo(0);
  });
});
