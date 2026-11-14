import { describe, expect, it } from 'vitest';
import { CellBuffer } from '../src/engine/cellBuffer';
import { Trails } from '../src/engine/trails';
import { makeGrid } from '../src/engine/grid';
import { PaletteTable } from '../src/engine/palettes';
import { World } from '../src/engine/world';
import { ANIMALS, registerPalettes } from '../src/animals/registry';
import { mulberry32 } from '../src/math/rng';

registerPalettes(new PaletteTable());

function world(id: string, count = 12): { w: World; buf: CellBuffer } {
  const def = ANIMALS.find((a) => a.id === id)!;
  const buf = new CellBuffer();
  const trails = new Trails();
  const g = makeGrid(1600, 900, 9, 1);
  buf.resize(g.cols, g.rows);
  trails.resize(g.cols, g.rows);
  const w = new World(def, mulberry32(11), buf, trails, 11);
  w.countOverride = count;
  w.setGrid(g);
  w.syncCount();
  return { w, buf };
}

describe('every animal', () => {
  it('has all seven registered with distinct palettes', () => {
    expect(ANIMALS.map((a) => a.id)).toEqual(['butterfly', 'jellyfish', 'dragonfly', 'koi', 'frog', 'crane', 'crab']);
    for (const a of ANIMALS) for (const k of Object.keys(a.palettes)) expect(a.pal[k]).toBeTypeOf('number');
  });

  for (const a of ANIMALS) {
    it(`${a.id}: simulates 10 s without NaN, stays near the host, and renders`, () => {
      const { w, buf } = world(a.id);
      for (let i = 0; i < 600; i++) w.update(1 / 60);
      for (const e of w.entities) {
        for (const v of [e.x, e.y, e.vx, e.vy, e.heading, e.drawHeading, e.scale, e.phase]) expect(Number.isFinite(v)).toBe(true);
        const m = a.radius * e.scale * 9 + 5;
        expect(e.x).toBeGreaterThan(-m - 400);
        expect(e.x).toBeLessThan(1600 + m + 400);
      }
      w.render();
      expect(buf.occN).toBeGreaterThan(50 * Math.min(4, w.entities.length));
    });

    it(`${a.id}: ${a.clickMode === 'feed' ? 'feeds instead of scattering' : 'scatters away from a click'}`, () => {
      const { w } = world(a.id, 1);
      const e = w.entities[0];
      Object.assign(e, { x: 800, y: 450, vx: 0, vy: 0, panic: 0 });
      w.click(760, 450);
      if (a.clickMode === 'feed') {
        expect(e.panic).toBe(0);
        expect(w.pellets.length).toBeGreaterThan(0);
        return;
      }
      expect(e.panic).toBeGreaterThan(0);
      const x0 = e.x;
      for (let i = 0; i < 30; i++) w.update(1 / 60);
      expect(e.x).toBeGreaterThan(x0); // moved away (to the right)
    });
  }

  it('spawns are spread over the host (no RNG stride correlation)', () => {
    for (const a of ANIMALS) {
      const { w } = world(a.id, 30);
      const ys = w.entities.map((e) => e.y / 900);
      const mid = ys.filter((y) => y > 0.3 && y < 0.7).length;
      expect(mid).toBeGreaterThan(4);
    }
  });
});
