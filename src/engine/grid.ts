export interface Grid {
  w: number; // CSS px
  h: number;
  dpr: number;
  cell: number; // CSS px per cell
  cols: number;
  rows: number;
}

export function makeGrid(w: number, h: number, cell: number, devicePixelRatio: number): Grid {
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  return {
    w: W,
    h: H,
    dpr: Math.min(devicePixelRatio || 1, 2),
    cell,
    cols: Math.ceil(W / cell),
    rows: Math.ceil(H / cell),
  };
}

/** Mobile rule (§13): an 8 px cell when the host is narrower than 768 px. */
export const effectiveCell = (w: number, cellSize: number): number => (w < 768 ? Math.min(cellSize, 8) : cellSize);

/** CSS px per animal unit (scale 1), kept apart from the cell so the grid can be finer than the animals. */
export const animalUnit = (w: number): number => (w < 768 ? 8 : 9) * 1.25;
