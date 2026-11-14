import { GLYPHS, type Palette } from './palette';

/**
 * Pre-rendered glyph tiles, one per (colour, glyph, tint) triple, laid out on a
 * single offscreen canvas. fillText per cell per frame is far too slow, so the
 * renderer only ever does drawImage from here.
 */
export class Atlas {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private built = new Uint8Array(0);
  private cell = 0;
  private dpr = 1;
  private colorCount = 0;

  constructor(
    private readonly palette: Palette,
    private readonly createCanvas: () => HTMLCanvasElement,
  ) {}

  /** Drops every tile; call after a cell-size, DPR, theme or palette change. */
  rebuild(cell: number, dpr: number): void {
    this.cell = cell;
    this.dpr = dpr;
    this.colorCount = Math.max(this.palette.size, 1);
    const tile = Math.max(1, Math.round(cell * dpr));
    const w = tile * GLYPHS.length;
    const h = tile * this.colorCount * 2; // base row block, then tint row block
    if (!this.canvas) {
      this.canvas = this.createCanvas();
      this.ctx = this.canvas.getContext('2d');
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.built = new Uint8Array(GLYPHS.length * this.colorCount * 2);
    const ctx = this.ctx;
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(cell * dpr * 0.8)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    }
  }

  /** Source rect of a tile, rendering it on first use. */
  private slot(color: number, glyph: number, tint: boolean): number {
    const row = color + (tint ? this.colorCount : 0);
    return row * GLYPHS.length + glyph;
  }

  tileSize(): number {
    return Math.max(1, Math.round(this.cell * this.dpr));
  }

  sx(glyph: number): number {
    return glyph * this.tileSize();
  }

  sy(color: number, tint: boolean): number {
    return (color + (tint ? this.colorCount : 0)) * this.tileSize();
  }

  source(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** Makes sure a tile exists; returns false when it cannot be drawn. */
  ensure(color: number, glyph: number, tint: boolean): boolean {
    const ctx = this.ctx;
    if (!ctx || glyph <= 0 || color <= 0 || color >= this.colorCount) return false;
    const s = this.slot(color, glyph, tint);
    if (this.built[s]) return true;
    const t = this.tileSize();
    const x = this.sx(glyph);
    const y = this.sy(color, tint);
    ctx.fillStyle = tint ? this.palette.tints[color] : this.palette.colors[color];
    ctx.fillText(GLYPHS[glyph], x + t / 2, y + t / 2 + t * 0.03);
    this.built[s] = 1;
    return true;
  }
}
