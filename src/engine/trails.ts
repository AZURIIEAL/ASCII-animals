import { G } from './shapes';
import { lineKey } from './atlas';

const TRAIL_GLYPHS = [G['.'], G[':'], G['-'], G['='], G['+']];

/**
 * Decaying intensity per cell (§6.6). Active cells are kept in a list, so
 * decay and drawing only touch cells that have a trail.
 */
export class Trails {
  cols = 0;
  rows = 0;
  intensity = new Float32Array(0);
  pal = new Uint8Array(0);
  tau = new Float32Array(0);
  list = new Int32Array(0);
  n = 0;

  resize(cols: number, rows: number): void {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.intensity = new Float32Array(n);
    this.pal = new Uint8Array(n);
    this.tau = new Float32Array(n);
    this.list = new Int32Array(n);
    this.n = 0;
  }

  add(col: number, row: number, value: number, pal: number, tau: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = row * this.cols + col;
    if (this.intensity[i] <= 0) this.list[this.n++] = i;
    if (value > this.intensity[i]) this.intensity[i] = value > 1 ? 1 : value;
    this.pal[i] = pal;
    this.tau[i] = tau;
  }

  decay(dt: number): void {
    let w = 0;
    for (let k = 0; k < this.n; k++) {
      const i = this.list[k];
      const v = this.intensity[i] * Math.exp(-dt / this.tau[i]);
      if (v < 0.03) this.intensity[i] = 0;
      else {
        this.intensity[i] = v;
        this.list[w++] = i;
      }
    }
    this.n = w;
  }

  clear(): void {
    for (let k = 0; k < this.n; k++) this.intensity[this.list[k]] = 0;
    this.n = 0;
  }

  /** Key for a trail cell: glyph by intensity. */
  keyAt(i: number): number {
    const v = this.intensity[i];
    const g = TRAIL_GLYPHS[Math.min(TRAIL_GLYPHS.length - 1, (v * TRAIL_GLYPHS.length) | 0)];
    return lineKey(this.pal[i], g);
  }
}
