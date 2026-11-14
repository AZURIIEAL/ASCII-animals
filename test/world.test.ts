import { describe, expect, it } from 'vitest';
import { entityCount, scatterRadius, World } from '../src/engine/world';
import { makeEntity } from '../src/animals/types';
import { DEFAULT_TWEAKS } from '../src/types';

const makeWorld = (w = 1920, h = 1080, tweaks = DEFAULT_TWEAKS): World => {
  const world = new World({ ...tweaks }, 'dark', 'butterfly', 1234);
  world.resize(w, h, tweaks.cellSize, 1);
  return world;
};

describe('entity count (§7.3)', () => {
  it('matches the reference host at density 1', () => {
    expect(entityCount(26, 1920, 1080, 1)).toBe(26);
  });

  it('scales with area and density', () => {
    expect(entityCount(26, 960, 1080, 1)).toBe(13);
    expect(entityCount(26, 1920, 1080, 2)).toBe(52);
  });

  it('applies the 0.6 mobile factor below 768 px', () => {
    const wide = entityCount(80, 800, 1080, 1);
    const narrow = entityCount(80, 760, 1080, 1);
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBe(Math.min(80, Math.round(80 * ((760 * 1080) / (1920 * 1080)) * 0.6)));
  });

  it('clamps to [4, 80]', () => {
    expect(entityCount(26, 200, 200, 0.25)).toBe(4);
    expect(entityCount(26, 4000, 3000, 2)).toBe(80);
  });
});

describe('scatter (§9.2)', () => {
  it('pushes away from the click, with falloff to zero at R', () => {
    const world = makeWorld();
    const R = scatterRadius(world.grid.width, world.grid.height);
    world.entities = [
      makeEntity({ x: 500, y: 400 }), // 100 px to the right of the click
      makeEntity({ x: 400 + R, y: 400 }), // exactly at R
    ];
    world.scatter({ x: 400, y: 400 });
    const [near, edge] = world.entities;
    expect(near.vx).toBeGreaterThan(0);
    expect(near.vy).toBeCloseTo(0);
    expect(near.panic).toBeGreaterThan(0);
    expect(edge.vx).toBe(0);
    expect(edge.panic).toBe(0);
  });

  it('falls off quadratically', () => {
    const world = makeWorld();
    const R = scatterRadius(world.grid.width, world.grid.height);
    world.entities = [
      makeEntity({ x: 400 + R * 0.25, y: 400 }),
      makeEntity({ x: 400 + R * 0.5, y: 400 }),
    ];
    world.scatter({ x: 400, y: 400 });
    const [a, b] = world.entities;
    expect(a.vx / b.vx).toBeCloseTo((1 - 0.25) ** 2 / (1 - 0.5) ** 2, 5);
  });

  it('leaves feeding animals (koi) alone', () => {
    const world = makeWorld();
    world.def = { ...world.def, clickMode: 'feed' };
    world.entities = [makeEntity({ x: 420, y: 400 })];
    world.scatter({ x: 400, y: 400 });
    expect(world.entities[0].vx).toBe(0);
    expect(world.entities[0].panic).toBe(0);
  });

  it('decays panic at 0.8/s', () => {
    const world = makeWorld();
    const e = world.def.spawn(world, world.rng, false);
    e.x = 400;
    e.y = 400;
    e.panic = 1;
    world.entities = [e];
    world.update(0.5);
    expect(e.panic).toBeCloseTo(0.6, 5);
  });
});

describe('population', () => {
  it('fills to the target count on populate()', () => {
    const world = makeWorld();
    world.populate();
    expect(world.entities.length).toBe(world.targetCount);
  });

  it('tops up gradually, about 10 per second, after a density increase', () => {
    const world = makeWorld();
    world.populate();
    const before = world.entities.length;
    world.tweaks = { ...world.tweaks, density: 2 };
    for (let i = 0; i < 10; i++) world.update(0.1); // 1 s
    const added = world.entities.length - before;
    expect(added).toBeGreaterThan(5);
    expect(added).toBeLessThanOrEqual(12);
    expect(world.entities.length).toBeLessThan(world.targetCount);
  });

  it('removes every exiting entity within 0.8 s (§11)', () => {
    const world = makeWorld();
    world.populate();
    const originals = new Set(world.entities);
    for (const e of world.entities) {
      e.exiting = true;
      e.exitT = 0;
    }
    for (let i = 0; i < 17; i++) world.update(0.05); // 0.85 s
    for (const e of world.entities) expect(originals.has(e)).toBe(false);
  });
});

describe('resize', () => {
  it('keeps entities and pulls them back inside the new bounds', () => {
    const world = makeWorld();
    world.populate();
    const n = world.entities.length;
    world.resize(600, 400, 12, 1);
    expect(world.entities.length).toBe(n);
    for (const e of world.entities) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(600);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(400);
    }
  });
});
