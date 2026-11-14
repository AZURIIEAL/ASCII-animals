import { clamp01 } from './shapes';

export type RGB = [number, number, number];

export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const css = (c: RGB): string => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/** Sample a dark→light ramp at t ∈ [0, 1]. */
export function ramp(stops: RGB[], t: number): RGB {
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export interface Palette {
  id: string; // `${animal}.${name}`
  stops: RGB[];
  /** Ramp position used for glyph-only cells. */
  line: number;
}

/**
 * Global palette table. Animals register their ramps once; the index is the palette's
 * atlas slot (rows 2p and 2p+1).
 */
export class PaletteTable {
  readonly list: Palette[] = [];
  private byId = new Map<string, number>();

  add(id: string, stops: string[], line = 0.7): number {
    const have = this.byId.get(id);
    if (have !== undefined) return have;
    const i = this.list.length;
    this.list.push({ id, stops: stops.map(hex), line });
    this.byId.set(id, i);
    return i;
  }
}
