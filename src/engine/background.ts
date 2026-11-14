import type { Rng } from '../math/rng';
import type { Theme } from '../types';
import type { Grid } from './grid';

const BG_GLYPHS = ['.', ',', ':', ';', "'", '`', '-', '_', '=', '+', '|', '/', '\\'];

export const BG_COLOR: Record<Theme, string> = { dark: '#0a0a0c', light: '#fafafa' };
const FG_COLOR: Record<Theme, string> = { dark: '#e5e7eb', light: '#0a0a0a' };

/**
 * The faint keyboard-character field. Drawn once to an offscreen canvas and
 * blitted every frame; shimmer repaints roughly 1% of cells per second.
 */
export class Background {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glyph: Uint8Array = new Uint8Array(0);
  private alpha: Float32Array = new Float32Array(0);
  private shimmerDebt = 0;

  constructor(
    private readonly createCanvas: () => HTMLCanvasElement,
    private readonly rng: Rng,
  ) {}

  rebuild(grid: Grid, density: number, theme: Theme): void {
    if (!this.canvas) {
      this.canvas = this.createCanvas();
      this.ctx = this.canvas.getContext('2d');
    }
    const w = Math.max(1, Math.round(grid.width * grid.dpr));
    const h = Math.max(1, Math.round(grid.height * grid.dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    const n = grid.cellCount;
    this.glyph = new Uint8Array(n);
    this.alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.rng.next() < density) {
        this.glyph[i] = 1 + Math.floor(this.rng.next() * BG_GLYPHS.length);
        this.alpha[i] = this.rng.range(0.04, 0.11);
      }
    }
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(grid.dpr, 0, 0, grid.dpr, 0, 0);
    ctx.clearRect(0, 0, grid.width, grid.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(grid.cell * 0.8)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = FG_COLOR[theme];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        this.paint(ctx, grid, row * grid.cols + col, col, row);
      }
    }
    ctx.globalAlpha = 1;
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    grid: Grid,
    i: number,
    col: number,
    row: number,
  ): void {
    const g = this.glyph[i];
    if (!g) return;
    ctx.globalAlpha = this.alpha[i];
    ctx.fillText(BG_GLYPHS[g - 1], grid.cx(col), grid.cy(row));
  }

  /** Repaints ~1% of cells per second with a fresh glyph. */
  shimmer(grid: Grid, dt: number, density: number, theme: Theme): void {
    const ctx = this.ctx;
    if (!ctx || this.glyph.length === 0) return;
    this.shimmerDebt += grid.cellCount * 0.01 * dt;
    let count = Math.floor(this.shimmerDebt);
    if (count <= 0) return;
    if (count > 400) count = 400; // after a long pause, don't repaint the world
    this.shimmerDebt -= count;
    ctx.fillStyle = FG_COLOR[theme];
    for (let k = 0; k < count; k++) {
      const i = Math.floor(this.rng.next() * this.glyph.length);
      const col = i % grid.cols;
      const row = (i - col) / grid.cols;
      ctx.globalAlpha = 1;
      ctx.clearRect(col * grid.cell, row * grid.cell, grid.cell, grid.cell);
      if (this.rng.next() < density) {
        this.glyph[i] = 1 + Math.floor(this.rng.next() * BG_GLYPHS.length);
        this.alpha[i] = this.rng.range(0.04, 0.11);
      } else {
        this.glyph[i] = 0;
      }
      this.paint(ctx, grid, i, col, row);
    }
    ctx.globalAlpha = 1;
  }

  source(): HTMLCanvasElement | null {
    return this.canvas;
  }
}
