import { clamp01, LINE_GLYPHS } from './shapes';
import { css, mix, ramp, type Palette } from './palettes';

export const STEPS = 24; // shade steps per palette
export const TILE_GLYPHS = ' .:-=+*#%@'; // brightness ramp for the glyph inside a tile
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

/** key = atlasRow * 64 + atlasCol. Row 2p: shaded tiles of palette p. Row 2p+1: its glyph-only cells. */
export const tileKey = (pal: number, shade: number): number => pal * 128 + Math.round(clamp01(shade) * (STEPS - 1));
export const lineKey = (pal: number, glyph: number): number => (pal * 2 + 1) * 64 + glyph;

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** Device pixels per atlas cell. */
  apx: number;
}

/** Pre-render every tile and glyph-only cell so drawing is one drawImage per cell (spec §6.5). */
export function buildAtlas(palettes: Palette[], cell: number, dpr: number): Atlas {
  const apx = Math.max(1, Math.round(cell * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = apx * Math.max(STEPS, LINE_GLYPHS.length);
  canvas.height = apx * Math.max(1, palettes.length) * 2;
  const g = canvas.getContext('2d');
  if (!g) return { canvas, apx };
  const gap = Math.max(1, Math.round(apx * 0.16));
  const rad = Math.max(1, apx * 0.18);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tileFont = `${Math.round(apx * 0.56)}px ${FONT}`;
  const lineFont = `${Math.round(apx * 0.8)}px ${FONT}`;

  palettes.forEach((p, pi) => {
    const y = pi * 2 * apx;
    for (let s = 0; s < STEPS; s++) {
      const t = s / (STEPS - 1);
      const col = ramp(p.stops, t);
      const x = s * apx;
      g.fillStyle = css(col);
      g.beginPath();
      g.roundRect(x + gap / 2, y + gap / 2, apx - gap, apx - gap, rad);
      g.fill();
      // Glyph: small and low contrast. It's texture, not text.
      const lum = (0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]) / 255;
      g.fillStyle = css(lum > 0.42 ? mix(col, [0, 0, 0], 0.32) : mix(col, [255, 255, 255], 0.16));
      g.font = tileFont;
      const ch = TILE_GLYPHS[Math.min(TILE_GLYPHS.length - 1, Math.floor(t * TILE_GLYPHS.length))];
      g.fillText(ch, x + apx / 2, y + apx / 2 + apx * 0.03);
    }
    g.fillStyle = css(ramp(p.stops, p.line));
    g.font = lineFont;
    LINE_GLYPHS.forEach((ch, gi) => g.fillText(ch, gi * apx + apx / 2, y + apx + apx / 2));
  });
  return { canvas, apx };
}
