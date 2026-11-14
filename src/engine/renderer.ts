import type { Atlas } from './atlas';
import type { CellBuffer } from './cellBuffer';
import type { Grid } from './grid';
import type { Trails } from './trails';

/** Background → trails → buffer. One drawImage per occupied cell; never fillText per frame (§6.5). */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  bg: HTMLCanvasElement,
  atlas: Atlas,
  buf: CellBuffer,
  trails: Trails,
  dim: Float32Array,
  trailsOn: boolean,
): void {
  const { cols, cell, dpr } = grid;
  const apx = atlas.apx;
  const img = atlas.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (trailsOn) {
    for (let k = 0; k < trails.n; k++) {
      const i = trails.list[k];
      const key = trails.keyAt(i);
      ctx.globalAlpha = 0.6 * trails.intensity[i] * dim[i];
      const col = i % cols;
      const row = (i / cols) | 0;
      ctx.drawImage(img, (key & 63) * apx, (key >> 6) * apx, apx, apx, col * cell, row * cell, cell, cell);
    }
  }

  for (let n = 0; n < buf.occN; n++) {
    const i = buf.occ[n];
    const key = buf.key[i];
    ctx.globalAlpha = buf.alpha[i] * dim[i];
    const col = i % cols;
    const row = (i / cols) | 0;
    ctx.drawImage(img, (key & 63) * apx, (key >> 6) * apx, apx, apx, col * cell, row * cell, cell, cell);
  }
  ctx.globalAlpha = 1;
}
