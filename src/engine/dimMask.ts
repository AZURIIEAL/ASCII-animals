import { smooth } from './shapes';
import type { Grid } from './grid';

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const DIM_FALLOFF = 120; // px over which the dim fades out: soft, never a hard rectangle

/** Per-cell dim factor: 0.3 + 0.7 × smooth(0, 120, distance to nearest rect) (rule 8). */
export function computeDim(grid: Grid, rects: Rect[], out?: Float32Array): Float32Array {
  const n = grid.cols * grid.rows;
  const dim = out && out.length === n ? out : new Float32Array(n);
  dim.fill(1);
  if (!rects.length) return dim;
  const c = grid.cell;
  for (let row = 0; row < grid.rows; row++) {
    const y = (row + 0.5) * c;
    for (let col = 0; col < grid.cols; col++) {
      const x = (col + 0.5) * c;
      let d = 1e9;
      for (const R of rects) {
        const dx = Math.max(R.l - x, 0, x - R.r);
        const dy = Math.max(R.t - y, 0, y - R.b);
        const dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < d) d = dd;
      }
      if (d < DIM_FALLOFF) dim[row * grid.cols + col] = 0.3 + 0.7 * smooth(0, DIM_FALLOFF, d);
    }
  }
  return dim;
}

/** Rects of `selector` matches inside `host`, relative to the host's padding box. */
export function dimRects(host: HTMLElement, selector: string): Rect[] {
  const hr = host.getBoundingClientRect();
  const ox = hr.left + host.clientLeft;
  const oy = hr.top + host.clientTop;
  const out: Rect[] = [];
  host.querySelectorAll(selector).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) out.push({ l: r.left - ox, t: r.top - oy, r: r.right - ox, b: r.bottom - oy });
  });
  return out;
}
