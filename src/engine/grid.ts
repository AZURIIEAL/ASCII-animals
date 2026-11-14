/** Grid geometry: CSS pixels, cells and device pixels in one place. */
export class Grid {
  /** CSS px */
  width = 0;
  height = 0;
  /** CSS px per cell */
  cell = 12;
  cols = 0;
  rows = 0;
  dpr = 1;

  set(width: number, height: number, cell: number, dpr: number): boolean {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const c = Math.max(4, cell);
    const d = Math.min(dpr, 2);
    const changed = w !== this.width || h !== this.height || c !== this.cell || d !== this.dpr;
    this.width = w;
    this.height = h;
    this.cell = c;
    this.dpr = d;
    this.cols = Math.ceil(w / c);
    this.rows = Math.ceil(h / c);
    return changed;
  }

  get cellCount(): number {
    return this.cols * this.rows;
  }

  colAt(x: number): number {
    return Math.floor(x / this.cell);
  }

  rowAt(y: number): number {
    return Math.floor(y / this.cell);
  }

  /** Centre of a cell, in CSS px. */
  cx(col: number): number {
    return (col + 0.5) * this.cell;
  }

  cy(row: number): number {
    return (row + 0.5) * this.cell;
  }
}

export const deviceRatio = (): number =>
  Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
