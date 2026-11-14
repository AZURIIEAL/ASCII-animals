/**
 * Per-frame cell buffer. Only cells written this frame are listed in `occ`,
 * so drawing never scans the whole grid (spec §6.3).
 */
export class CellBuffer {
  cols = 0;
  rows = 0;
  alpha = new Float32Array(0);
  key = new Uint16Array(0);
  pri = new Float32Array(0);
  frame = new Uint32Array(0);
  occ = new Int32Array(0);
  occN = 0;
  private frameNo = 1;

  resize(cols: number, rows: number): void {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.alpha = new Float32Array(n);
    this.key = new Uint16Array(n);
    this.pri = new Float32Array(n);
    this.frame = new Uint32Array(n);
    this.occ = new Int32Array(n);
    this.occN = 0;
    this.frameNo = 1;
  }

  /** Start a new frame: forget every stamp without clearing the arrays. */
  begin(): void {
    this.frameNo++;
    this.occN = 0;
  }

  /** First write this frame registers the cell; afterwards, higher (or equal) priority wins. */
  stamp(col: number, row: number, key: number, alpha: number, pri: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows || alpha < 0.03) return;
    const i = row * this.cols + col;
    if (this.frame[i] !== this.frameNo) {
      this.frame[i] = this.frameNo;
      this.occ[this.occN++] = i;
      this.pri[i] = -1e9;
    }
    if (pri >= this.pri[i]) {
      this.pri[i] = pri;
      this.key[i] = key;
      this.alpha[i] = alpha > 1 ? 1 : alpha;
    }
  }
}
