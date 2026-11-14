import type { Grid } from './grid';
import type { Rng } from '../math/rng';

const BG_GLYPHS = ".,:;'`-_=+|/\\";

const THEMES = {
  dark: { fill: '#0a0a0c', tile: 'rgba(255,255,255,0.022)', glyph: '229,231,235' },
  light: { fill: '#fafafa', tile: 'rgba(0,0,0,0.03)', glyph: '10,10,10' },
} as const;

export type Theme = keyof typeof THEMES;

/** Faint tile + glyph field, drawn once to an offscreen canvas, with a slow shimmer (§6.2). */
export class Background {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d');
  private grid: Grid | null = null;

  constructor(
    private rng: Rng,
    public theme: Theme,
    public density: number,
  ) {}

  build(grid: Grid): void {
    this.grid = grid;
    this.canvas.width = Math.round(grid.w * grid.dpr);
    this.canvas.height = Math.round(grid.h * grid.dpr);
    const g = this.canvas.getContext('2d');
    this.ctx = g;
    if (!g) return;
    g.setTransform(grid.dpr, 0, 0, grid.dpr, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.round(grid.cell * 0.62)}px ui-monospace, Menlo, Consolas, monospace`;
    g.fillStyle = THEMES[this.theme].fill;
    g.fillRect(0, 0, grid.w, grid.h);
    for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) this.cell(col, row);
  }

  private cell(col: number, row: number): void {
    const g = this.ctx;
    const grid = this.grid;
    if (!g || !grid) return;
    const t = THEMES[this.theme];
    const c = grid.cell;
    const x = col * c;
    const y = row * c;
    g.fillStyle = t.fill;
    g.fillRect(x, y, c, c);
    g.fillStyle = t.tile;
    g.beginPath();
    g.roundRect(x + 0.7, y + 0.7, c - 1.4, c - 1.4, 1.5);
    g.fill();
    const r = this.rng;
    if (r() < this.density) {
      const a = 0.04 + 0.06 * r();
      g.fillStyle = `rgba(${t.glyph},${a.toFixed(3)})`;
      g.fillText(BG_GLYPHS[(r() * BG_GLYPHS.length) | 0], x + c / 2, y + c / 2);
    }
  }

  /** Re-roll about 1% of cells per second. */
  shimmer(dt: number): void {
    const grid = this.grid;
    if (!grid) return;
    const k = Math.floor(grid.cols * grid.rows * 0.01 * dt + this.rng());
    for (let i = 0; i < k; i++) this.cell((this.rng() * grid.cols) | 0, (this.rng() * grid.rows) | 0);
  }
}
