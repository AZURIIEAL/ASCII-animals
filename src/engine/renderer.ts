import type { Theme, Tweaks } from '../types';
import { Atlas } from './atlas';
import { Background, BG_COLOR } from './background';
import type { CellBuffer } from './cellBuffer';
import type { DimMask } from './dimMask';
import type { Grid } from './grid';
import type { Palette } from './palette';
import type { Trails } from './trails';

/** Draw order: background → trails → cell buffer. */
export class Renderer {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly palette: Palette,
    readonly atlas: Atlas,
    readonly background: Background,
  ) {}

  draw(
    grid: Grid,
    buf: CellBuffer,
    trails: Trails,
    mask: DimMask,
    tweaks: Tweaks,
    theme: Theme,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(grid.dpr, 0, 0, grid.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG_COLOR[theme];
    ctx.fillRect(0, 0, grid.width, grid.height);

    const bg = this.background.source();
    if (bg) ctx.drawImage(bg, 0, 0, grid.width, grid.height);

    const c = grid.cell;
    const tile = this.atlas.tileSize();
    const src = this.atlas.source();

    if (tweaks.trails && trails.intensity.length === grid.cellCount) {
      for (let i = 0; i < trails.intensity.length; i++) {
        const v = trails.intensity[i];
        if (v <= 0.01) continue;
        const color = trails.color[i];
        if (color === 0) continue;
        const glyph = trails.glyphFor(v);
        if (!src || !this.atlas.ensure(color, glyph, false)) continue;
        const col = i % grid.cols;
        const row = (i - col) / grid.cols;
        ctx.globalAlpha = v * 0.6 * mask.factorAt(i);
        ctx.drawImage(
          src,
          this.atlas.sx(glyph),
          this.atlas.sy(color, false),
          tile,
          tile,
          col * c,
          row * c,
          c,
          c,
        );
      }
    }

    const blocks = tweaks.style === 'blocks';
    const colors = this.palette.colors;
    for (let i = 0; i < buf.color.length; i++) {
      const color = buf.color[i];
      if (color === 0) continue;
      const a = buf.alpha[i] * mask.factorAt(i);
      if (a <= 0.01) continue;
      const col = i % grid.cols;
      const row = (i - col) / grid.cols;
      const x = col * c;
      const y = row * c;
      if (blocks) {
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = colors[color];
        ctx.fillRect(x, y, c - 1, c - 1);
      }
      const glyph = buf.glyph[i];
      if (glyph > 0 && src && this.atlas.ensure(color, glyph, blocks)) {
        ctx.globalAlpha = a;
        ctx.drawImage(
          src,
          this.atlas.sx(glyph),
          this.atlas.sy(color, blocks),
          tile,
          tile,
          x,
          y,
          c,
          c,
        );
      }
    }
    ctx.globalAlpha = 1;
  }
}
