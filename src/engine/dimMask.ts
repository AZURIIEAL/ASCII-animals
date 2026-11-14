import type { Grid } from './grid';

export const DIM_FACTOR = 0.35;

/**
 * Cells sitting behind hero text (elements matching `dimSelector`) render dimmer,
 * so the copy stays readable.
 */
export class DimMask {
  cells: Uint8Array = new Uint8Array(0);
  private any = false;

  resize(grid: Grid): void {
    const n = grid.cellCount;
    if (this.cells.length !== n) this.cells = new Uint8Array(n);
    else this.cells.fill(0);
    this.any = false;
  }

  /** `rects` are host-local, in CSS px. Each is padded by one cell. */
  build(grid: Grid, rects: readonly DOMRectReadOnly[] | readonly DOMRect[]): void {
    this.resize(grid);
    const c = grid.cell;
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const c0 = Math.max(0, Math.floor(r.left / c) - 1);
      const c1 = Math.min(grid.cols - 1, Math.floor((r.left + r.width) / c) + 1);
      const r0 = Math.max(0, Math.floor(r.top / c) - 1);
      const r1 = Math.min(grid.rows - 1, Math.floor((r.top + r.height) / c) + 1);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) this.cells[row * grid.cols + col] = 1;
      }
      if (c1 >= c0 && r1 >= r0) this.any = true;
    }
  }

  get active(): boolean {
    return this.any;
  }

  factorAt(i: number): number {
    return this.any && this.cells[i] ? DIM_FACTOR : 1;
  }
}
