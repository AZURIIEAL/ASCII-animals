import { glyphIndex } from './palette';

/** Glyph ramp used for trail intensity, dimmest first. */
const RAMP = ['.', ':', '-', '=', '+'].map(glyphIndex);

/**
 * Decaying intensity buffer. Animals stamp into it; it fades exponentially and
 * draws underneath the cell buffer.
 */
export class Trails {
  cols = 0;
  rows = 0;
  intensity: Float32Array = new Float32Array(0);
  color: Uint8Array = new Uint8Array(0);
  /** Per-animal decay constant, in seconds. */
  tau = 0.25;

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    if (this.intensity.length !== n) {
      this.intensity = new Float32Array(n);
      this.color = new Uint8Array(n);
    } else {
      this.clear();
    }
  }

  clear(): void {
    this.intensity.fill(0);
    this.color.fill(0);
  }

  stamp(col: number, row: number, color: number, amount: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = row * this.cols + col;
    const v = this.intensity[i] + amount;
    this.intensity[i] = v > 1 ? 1 : v;
    this.color[i] = color;
  }

  decay(dt: number): void {
    const k = Math.exp(-dt / this.tau);
    const a = this.intensity;
    for (let i = 0; i < a.length; i++) {
      const v = a[i] * k;
      a[i] = v < 0.004 ? 0 : v;
    }
  }

  glyphFor(intensity: number): number {
    const i = Math.min(RAMP.length - 1, Math.max(0, Math.floor(intensity * RAMP.length)));
    return RAMP[i];
  }
}
