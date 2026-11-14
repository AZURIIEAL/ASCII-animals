import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';

describe('CellBuffer', () => {
  it('registers each cell once per frame and keeps the highest priority', () => {
    const b = new CellBuffer();
    b.resize(4, 3);
    b.begin();
    b.stamp(1, 1, 10, 0.5, 0.2);
    b.stamp(1, 1, 20, 0.9, 0.1); // lower priority: ignored
    b.stamp(1, 1, 30, 0.7, 0.8); // higher: wins
    b.stamp(2, 2, 40, 1, 0);
    expect(b.occN).toBe(2);
    const i = 1 * 4 + 1;
    expect(b.key[i]).toBe(30);
    expect(b.alpha[i]).toBeCloseTo(0.7);
  });
  it('drops out-of-range and near-invisible stamps; begin() resets', () => {
    const b = new CellBuffer();
    b.resize(4, 3);
    b.begin();
    b.stamp(-1, 0, 1, 1, 0);
    b.stamp(4, 0, 1, 1, 0);
    b.stamp(0, 3, 1, 1, 0);
    b.stamp(0, 0, 1, 0.01, 0);
    expect(b.occN).toBe(0);
    b.stamp(0, 0, 1, 1, 5);
    b.begin();
    b.stamp(0, 0, 2, 1, -10); // previous frame's priority must not carry over
    expect(b.occN).toBe(1);
    expect(b.key[0]).toBe(2);
  });
});
