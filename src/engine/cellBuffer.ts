/**
 * Per-frame cell buffer. Rebuilt from scratch every frame; typed arrays only,
 * so there is nothing to allocate or collect mid-frame.
 */
export class CellBuffer {
  cols = 0;
  rows = 0;
  /** palette index, 0 = empty */
  color: Uint8Array = new Uint8Array(0);
  /** index into the glyph table */
  glyph: Uint8Array = new Uint8Array(0);
  alpha: Float32Array = new Float32Array(0);
  /** higher wins */
  depth: Uint8Array = new Uint8Array(0);

  constructor(cols = 0, rows = 0) {
    this.resize(cols, rows);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    if (this.color.length !== n) {
      this.color = new Uint8Array(n);
      this.glyph = new Uint8Array(n);
      this.alpha = new Float32Array(n);
      this.depth = new Uint8Array(n);
    } else {
      this.clear();
    }
  }

  clear(): void {
    this.color.fill(0);
    this.depth.fill(0);
  }

  /** Writes only if depth >= the depth already there; out-of-bounds cells are ignored. */
  stamp(
    col: number,
    row: number,
    color: number,
    glyph: number,
    alpha: number,
    depth: number,
  ): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = row * this.cols + col;
    if (this.color[i] !== 0 && depth < this.depth[i]) return;
    this.color[i] = color;
    this.glyph[i] = glyph;
    this.alpha[i] = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    this.depth[i] = depth;
  }

  occupied(): number {
    let n = 0;
    for (let i = 0; i < this.color.length; i++) if (this.color[i] !== 0) n++;
    return n;
  }
}
