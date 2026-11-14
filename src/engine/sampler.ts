import type { CellBuffer } from './cellBuffer';
import type { Grid } from './grid';
import { glyphIndex, type Palette } from './palette';

export interface SpritePaletteEntry {
  color: string;
  glyph: string;
  alpha?: number;
}

export interface Sprite {
  /** each frame = array of equal-length rows; all frames the same size */
  frames: string[][];
  palette: Record<string, SpritePaletteEntry>;
  /** pivot in cells, default centre */
  anchor?: [number, number];
  /** radians the art faces: 0 = right, -PI/2 = up */
  facing: number;
}

/** Resolved sprite: palette keys turned into table indices once, at startup. */
export interface CompiledSprite {
  frames: Uint8Array[];
  /** per frame, per cell: 0 = empty, else 1 + entry index */
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  facing: number;
  colors: number[];
  glyphs: number[];
  alphas: number[];
  radius: number;
}

export function compileSprite(sprite: Sprite, palette: Palette): CompiledSprite {
  const keys = Object.keys(sprite.palette);
  const colors: number[] = [];
  const glyphs: number[] = [];
  const alphas: number[] = [];
  const keyIndex = new Map<string, number>();
  keys.forEach((k, i) => {
    const entry = sprite.palette[k];
    keyIndex.set(k, i);
    colors[i] = palette.register(entry.color);
    glyphs[i] = glyphIndex(entry.glyph);
    alphas[i] = entry.alpha ?? 1;
  });

  const h = sprite.frames[0].length;
  const w = sprite.frames[0][0].length;
  const frames = sprite.frames.map((rows) => {
    const buf = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const line = rows[y] ?? '';
      for (let x = 0; x < w; x++) {
        const ch = line[x] ?? '.';
        if (ch === '.' || ch === ' ') continue;
        const i = keyIndex.get(ch);
        if (i === undefined) continue;
        buf[y * w + x] = 1 + i;
      }
    }
    return buf;
  });

  return {
    frames,
    w,
    h,
    anchorX: sprite.anchor ? sprite.anchor[0] : w / 2,
    anchorY: sprite.anchor ? sprite.anchor[1] : h / 2,
    facing: sprite.facing,
    colors,
    glyphs,
    alphas,
    radius: Math.hypot(w, h) / 2,
  };
}

export interface StampOptions {
  x: number;
  y: number;
  heading: number;
  scale: number;
  alpha: number;
  depth: number;
  frame: number;
}

/**
 * Samples a sprite into the grid, rotated and scaled. Nearest neighbour only —
 * the chunky, stair-stepped diagonals are the look we want.
 */
export function stampSprite(
  buf: CellBuffer,
  grid: Grid,
  sprite: CompiledSprite,
  o: StampOptions,
): void {
  const c = grid.cell;
  const scale = o.scale <= 0 ? 0.001 : o.scale;
  const angle = o.heading - sprite.facing;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const frame = sprite.frames[((o.frame % sprite.frames.length) + sprite.frames.length) % sprite.frames.length];

  const radiusCells = Math.ceil(sprite.radius * scale) + 1;
  const col0 = grid.colAt(o.x) - radiusCells;
  const col1 = grid.colAt(o.x) + radiusCells;
  const row0 = grid.rowAt(o.y) - radiusCells;
  const row1 = grid.rowAt(o.y) + radiusCells;

  for (let row = row0; row <= row1; row++) {
    const wy = (row + 0.5) * c;
    const dy = wy - o.y;
    for (let col = col0; col <= col1; col++) {
      const wx = (col + 0.5) * c;
      const dx = wx - o.x;
      const lx = (dx * cos + dy * sin) / (c * scale);
      const ly = (-dx * sin + dy * cos) / (c * scale);
      const sx = Math.floor(lx + sprite.anchorX);
      const sy = Math.floor(ly + sprite.anchorY);
      if (sx < 0 || sy < 0 || sx >= sprite.w || sy >= sprite.h) continue;
      const v = frame[sy * sprite.w + sx];
      if (v === 0) continue;
      const k = v - 1;
      buf.stamp(col, row, sprite.colors[k], sprite.glyphs[k], o.alpha * sprite.alphas[k], o.depth);
    }
  }
}
