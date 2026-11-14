import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';

const at = (buf: CellBuffer, col: number, row: number): number => buf.color[row * buf.cols + col];

describe('CellBuffer', () => {
  it('stamps within bounds', () => {
    const buf = new CellBuffer(4, 3);
    buf.stamp(1, 1, 5, 2, 0.5, 10);
    expect(at(buf, 1, 1)).toBe(5);
    expect(buf.alpha[1 * 4 + 1]).toBeCloseTo(0.5);
  });

  it('ignores out-of-bounds cells', () => {
    const buf = new CellBuffer(4, 3);
    expect(() => {
      buf.stamp(-1, 0, 5, 1, 1, 1);
      buf.stamp(0, -1, 5, 1, 1, 1);
      buf.stamp(4, 0, 5, 1, 1, 1);
      buf.stamp(0, 3, 5, 1, 1, 1);
    }).not.toThrow();
    expect(buf.occupied()).toBe(0);
  });

  it('respects depth: equal or higher wins, lower loses', () => {
    const buf = new CellBuffer(2, 2);
    buf.stamp(0, 0, 3, 1, 1, 5);
    buf.stamp(0, 0, 4, 1, 1, 4);
    expect(at(buf, 0, 0)).toBe(3);
    buf.stamp(0, 0, 6, 1, 1, 5);
    expect(at(buf, 0, 0)).toBe(6);
    buf.stamp(0, 0, 7, 1, 1, 9);
    expect(at(buf, 0, 0)).toBe(7);
  });

  it('clamps alpha and clears', () => {
    const buf = new CellBuffer(2, 2);
    buf.stamp(0, 0, 1, 1, 2, 1);
    expect(buf.alpha[0]).toBe(1);
    buf.clear();
    expect(buf.occupied()).toBe(0);
  });
});
