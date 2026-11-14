import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';
import { Trails } from '../src/engine/trails';
import { makeGrid } from '../src/engine/grid';
import { scatterImpulse, scatterRadius, targetCount, World } from '../src/engine/world';
import { butterfly } from '../src/animals/butterfly';
import type { AnimalDef } from '../src/animals/types';
import { mulberry32 } from '../src/math/rng';

function makeWorld(def: AnimalDef = butterfly, count = 10): World {
  const buf = new CellBuffer();
  const trails = new Trails();
  const g = makeGrid(1920, 1080, 9, 1);
  buf.resize(g.cols, g.rows);
  trails.resize(g.cols, g.rows);
  const w = new World(def, mulberry32(7), buf, trails);
  w.countOverride = count;
  w.setGrid(g);
  w.syncCount();
  return w;
}

describe('count formula', () => {
  it('scales with area, density and mobile, clamped to [4, 80]', () => {
    expect(targetCount(26, 1920, 1080, 1)).toBe(26);
    expect(targetCount(26, 1920, 1080, 2)).toBe(52);
    expect(targetCount(26, 3840, 2160, 2)).toBe(80);
    expect(targetCount(26, 375, 700, 1)).toBe(4);
    expect(targetCount(20, 700, 1080 * 2, 1)).toBe(Math.round(20 * ((700 * 2160) / (1920 * 1080)) * 0.6));
  });
});

describe('scatter', () => {
  it('radius and falloff', () => {
    expect(scatterRadius(1800, 900)).toBe(240);
    expect(scatterRadius(300, 300)).toBeCloseTo(144);
    expect(scatterImpulse(0, 240)).toBe(900);
    expect(scatterImpulse(120, 240)).toBeCloseTo(225);
    expect(scatterImpulse(240, 240)).toBe(0);
  });
  it('pushes nearby entities away from the click and sets panic', () => {
    const w = makeWorld(butterfly, 2);
    const [near, far] = w.entities;
    Object.assign(near, { x: 500, y: 500, vx: 0, vy: 0, panic: 0 });
    Object.assign(far, { x: 1500, y: 900, vx: 0, vy: 0, panic: 0 });
    w.click(450, 500); // 50 px to the left of `near`
    expect(near.vx).toBeGreaterThan(0);
    expect(Math.abs(near.vy)).toBeLessThan(1e-9);
    expect(near.panic).toBeGreaterThan(0);
    expect(near.heading).toBeCloseTo(0);
    expect(far.vx).toBe(0);
    expect(far.panic).toBe(0);
  });
  it('feed-mode animals are not scattered', () => {
    const koiLike: AnimalDef = { ...butterfly, clickMode: 'feed', pal: butterfly.pal };
    const w = makeWorld(koiLike, 1);
    const e = w.entities[0];
    Object.assign(e, { x: 500, y: 500, vx: 0, vy: 0, panic: 0 });
    w.click(490, 500);
    expect(e.vx).toBe(0);
    expect(e.panic).toBe(0);
  });
  it('panic decays at 0.8/s', () => {
    const w = makeWorld(butterfly, 1);
    w.entities[0].panic = 1;
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    expect(w.entities[0].panic).toBeCloseTo(0.2, 5);
  });
});

describe('butterfly', () => {
  it('renders tiles and glyph-only antennae, deterministically', () => {
    const run = (): number[] => {
      const w = makeWorld(butterfly, 3);
      for (let i = 0; i < 120; i++) w.update(1 / 60);
      w.render();
      const b = (w as unknown as { buf: CellBuffer }).buf;
      return Array.from(b.occ.subarray(0, b.occN));
    };
    const a = run();
    expect(a.length).toBeGreaterThan(100);
    expect(run()).toEqual(a);
  });
  it('wraps around the edges with a margin', () => {
    const w = makeWorld(butterfly, 1);
    const e = w.entities[0];
    const m = butterfly.radius * e.scale * 9;
    Object.assign(e, { x: -m - 5, y: 500 });
    w.update(0);
    expect(e.x).toBeGreaterThan(1920);
  });
});

describe('switching animals', () => {
  it('flies the old animals out within 0.8 s and the new ones in over 0.6 s', async () => {
    const { koi } = await import('../src/animals/koi');
    const w = makeWorld(butterfly, 10);
    const old = [...w.entities];
    w.setAnimal(koi, true);
    expect(w.transitioning).toBe(true);
    expect(old.every((e) => e.exiting)).toBe(true);
    expect(w.entities.length).toBe(0); // the new ones arrive staggered
    for (let i = 0; i < 18; i++) w.update(1 / 60); // 0.3 s
    expect(w.entities.length).toBeGreaterThan(0);
    expect(w.entities.length).toBeLessThan(10);
    for (let i = 0; i < 31; i++) w.update(1 / 60); // ~0.82 s total
    expect(w.transitioning).toBe(false);
    expect(w.entities.length).toBe(10);
    expect(w.entities.every((e) => !e.exiting)).toBe(true);
    // Leaving animals are no longer rendered.
    w.render();
  });

  it('switches instantly without a transition', () => {
    const w = makeWorld(butterfly, 6);
    w.setAnimal(butterfly, false);
    expect(w.transitioning).toBe(false);
    expect(w.entities.length).toBe(6);
  });
});
