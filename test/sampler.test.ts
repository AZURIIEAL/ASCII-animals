import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';
import { Grid } from '../src/engine/grid';
import { Palette } from '../src/engine/palette';
import { compileSprite, stampSprite, type Sprite } from '../src/engine/sampler';

const line: Sprite = {
  facing: 0, // the art points right
  palette: { a: { color: '#ff0000', glyph: '#' } },
  frames: [['aaa']],
};

function setup(): { grid: Grid; buf: CellBuffer; sprite: ReturnType<typeof compileSprite> } {
  const grid = new Grid();
  grid.set(120, 120, 10, 1);
  const buf = new CellBuffer(grid.cols, grid.rows);
  const sprite = compileSprite(line, new Palette('dark'));
  return { grid, buf, sprite };
}

function occupiedCells(buf: CellBuffer): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < buf.color.length; i++) {
    if (buf.color[i] === 0) continue;
    const col = i % buf.cols;
    out.push([col, (i - col) / buf.cols]);
  }
  return out;
}

describe('sprite sampler', () => {
  it('stamps a 3×1 sprite as a horizontal run when unrotated', () => {
    const { grid, buf, sprite } = setup();
    stampSprite(buf, grid, sprite, {
      x: 55,
      y: 55,
      heading: 0,
      scale: 1,
      alpha: 1,
      depth: 1,
      frame: 0,
    });
    expect(occupiedCells(buf)).toEqual([
      [4, 5],
      [5, 5],
      [6, 5],
    ]);
  });

  it('rotated 90° stamps a vertical 1×3 line', () => {
    const { grid, buf, sprite } = setup();
    stampSprite(buf, grid, sprite, {
      x: 55,
      y: 55,
      heading: Math.PI / 2,
      scale: 1,
      alpha: 1,
      depth: 1,
      frame: 0,
    });
    expect(occupiedCells(buf)).toEqual([
      [5, 4],
      [5, 5],
      [5, 6],
    ]);
  });

  it('scale 2 doubles the footprint on each axis', () => {
    const { grid, buf, sprite } = setup();
    stampSprite(buf, grid, sprite, {
      x: 55,
      y: 55,
      heading: 0,
      scale: 2,
      alpha: 1,
      depth: 1,
      frame: 0,
    });
    const cells = occupiedCells(buf);
    const cols = new Set(cells.map(([c]) => c));
    const rows = new Set(cells.map(([, r]) => r));
    expect(cols.size).toBe(6); // 3 cells wide × 2
    expect(rows.size).toBe(2); // 1 cell tall × 2
    expect(cells.length).toBe(12);
  });

  it('carries per-key alpha from the sprite palette', () => {
    const grid = new Grid();
    grid.set(120, 120, 10, 1);
    const buf = new CellBuffer(grid.cols, grid.rows);
    const faint = compileSprite(
      { facing: 0, palette: { a: { color: '#ff0000', glyph: '#', alpha: 0.5 } }, frames: [['a']] },
      new Palette('dark'),
    );
    stampSprite(buf, grid, faint, {
      x: 55,
      y: 55,
      heading: 0,
      scale: 1,
      alpha: 0.8,
      depth: 1,
      frame: 0,
    });
    const i = 5 * buf.cols + 5;
    expect(buf.alpha[i]).toBeCloseTo(0.4);
  });
});
