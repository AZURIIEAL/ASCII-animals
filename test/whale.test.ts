import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';
import { Trails } from '../src/engine/trails';
import { makeGrid } from '../src/engine/grid';
import { PaletteTable } from '../src/engine/palettes';
import { World } from '../src/engine/world';
import { whale } from '../src/animals/whale';
import { registerPalettes } from '../src/animals/all';
import { mulberry32 } from '../src/math/rng';

function whaleWorld(): World {
  registerPalettes(new PaletteTable());
  const buf = new CellBuffer();
  const trails = new Trails();
  const g = makeGrid(1920, 1080, 9, 1);
  buf.resize(g.cols, g.rows);
  trails.resize(g.cols, g.rows);
  const w = new World(whale, mulberry32(5), buf, trails);
  w.setGrid(g);
  w.syncCount();
  return w;
}

const data = (w: World) => w.entities[0].data as { mode: number; depth: number };

describe('whale', () => {
  it('lives a full breathing cycle: cruise → dive → deep → rise → cruise', () => {
    const w = whaleWorld();
    const seen = new Set<number>();
    let maxDepth = 0;
    for (let i = 0; i < 90 * 60; i++) {
      w.update(1 / 60);
      seen.add(data(w).mode);
      maxDepth = Math.max(maxDepth, data(w).depth);
      if (i % 30 === 0) w.render();
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(maxDepth).toBe(1);
    const e = w.entities[0];
    expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.scale)).toBe(true);
  });

  it('breaches when clicked, then settles back to cruising', () => {
    const w = whaleWorld();
    const e = w.entities[0];
    const base = e.scale;
    w.click(e.x, e.y);
    expect(data(w).mode).toBe(4);
    let peak = 0;
    for (let i = 0; i < 4 * 60; i++) {
      w.update(1 / 60);
      peak = Math.max(peak, e.scale);
    }
    expect(peak).toBeGreaterThan(base * 1.2); // surges toward the viewer
    expect(data(w).mode).toBe(0);
  });
});
