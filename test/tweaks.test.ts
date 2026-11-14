import { describe, expect, it } from 'vitest';
import { DEFAULT_TWEAKS, sanitizeTweaks } from '../src/types';

describe('sanitizeTweaks', () => {
  it('clamps to the documented ranges', () => {
    const t = sanitizeTweaks(DEFAULT_TWEAKS, {
      density: 99,
      speed: -1,
      cellSize: 2,
      bgDensity: 5,
    });
    expect(t.density).toBe(2);
    expect(t.speed).toBe(0.25);
    expect(t.cellSize).toBe(8);
    expect(t.bgDensity).toBe(1);
  });

  it('ignores junk and keeps the previous value', () => {
    const t = sanitizeTweaks(DEFAULT_TWEAKS, {
      density: Number.NaN,
      style: 'rainbow' as never,
      trails: 'yes' as never,
    });
    expect(t.density).toBe(DEFAULT_TWEAKS.density);
    expect(t.style).toBe(DEFAULT_TWEAKS.style);
    expect(t.trails).toBe(DEFAULT_TWEAKS.trails);
  });

  it('applies valid values', () => {
    const t = sanitizeTweaks(DEFAULT_TWEAKS, { style: 'glyphs', trails: false, cellSize: 10 });
    expect(t).toMatchObject({ style: 'glyphs', trails: false, cellSize: 10 });
  });
});
