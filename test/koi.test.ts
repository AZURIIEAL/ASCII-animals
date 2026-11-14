import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';
import { Trails } from '../src/engine/trails';
import { makeGrid } from '../src/engine/grid';
import { PaletteTable } from '../src/engine/palettes';
import { PELLET_LIFE, World } from '../src/engine/world';
import { koi } from '../src/animals/koi';
import { registerPalettes } from '../src/animals/all';
import { mulberry32 } from '../src/math/rng';

function koiWorld(count: number): World {
  registerPalettes(new PaletteTable());
  const buf = new CellBuffer();
  const trails = new Trails();
  const g = makeGrid(1920, 1080, 9, 1);
  buf.resize(g.cols, g.rows);
  trails.resize(g.cols, g.rows);
  const w = new World(koi, mulberry32(3), buf, trails);
  w.countOverride = count;
  w.setGrid(g);
  w.syncCount();
  return w;
}

describe('koi feeding', () => {
  it('a click drops 6–12 pellets within 24 px and never scatters', () => {
    const w = koiWorld(5);
    const before = w.entities.map((e) => [e.vx, e.vy]);
    w.click(900, 500);
    expect(w.pellets.length).toBeGreaterThanOrEqual(6);
    expect(w.pellets.length).toBeLessThanOrEqual(12);
    for (const p of w.pellets) expect(Math.hypot(p.x - 900, p.y - 500)).toBeLessThanOrEqual(24);
    expect(w.entities.map((e) => [e.vx, e.vy])).toEqual(before);
    expect(w.entities.every((e) => e.panic === 0)).toBe(true);
  });

  it('pellets expire at 6 s', () => {
    const w = koiWorld(4);
    for (const e of w.entities) Object.assign(e, { x: 100, y: 100 }); // far away
    w.dropFood(1800, 1000);
    w.pellets.forEach((p) => Object.assign(p, { vx: 0, vy: 0 }));
    const n = w.pellets.length;
    for (let i = 0; i < Math.round((PELLET_LIFE - 0.1) * 60); i++) w.update(1 / 60);
    expect(w.pellets.length).toBe(n); // koi started ~1900 px away: nothing eaten yet
    for (let i = 0; i < 12; i++) w.update(1 / 60);
    expect(w.pellets.length).toBe(0);
  });

  it('a koi eats a pellet when its mouth is within 10 px', () => {
    const w = koiWorld(1);
    const e = w.entities[0];
    Object.assign(e, { x: 500, y: 500, vx: 70, vy: 0, heading: 0, drawHeading: 0, scale: 1 });
    const mouth = 5.8 * 9; // HEAD_V cells × cell px ahead of the centre
    w.pellets.push({ x: 500 + mouth + 6, y: 500, vx: 0, vy: 0, t: 0, life: 6, kind: 0 });
    w.pellets.push({ x: 500 + mouth, y: 700, vx: 0, vy: 0, t: 0, life: 6, kind: 0 }); // 200 px off: not eaten
    w.update(1 / 60);
    expect(w.pellets.length).toBe(1);
    expect(w.pellets[0].y).toBe(700);
  });

  it('koi swim toward food', () => {
    const w = koiWorld(1);
    const e = w.entities[0];
    Object.assign(e, { x: 500, y: 500, vx: 0, vy: -60, heading: -Math.PI / 2, drawHeading: -Math.PI / 2 });
    w.pellets.push({ x: 800, y: 500, vx: 0, vy: 0, t: 0, life: 6, kind: 0 });
    const d0 = Math.hypot(800 - e.x, 500 - e.y);
    for (let i = 0; i < 120; i++) w.update(1 / 60);
    expect(Math.hypot(800 - e.x, 500 - e.y)).toBeLessThan(d0 - 50);
  });
});
