/**
 * Shape fields evaluated per cell in an animal's local space (cells at scale 1;
 * u = right, v = back, head at negative v). See spec §6.4.
 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smoothstep from a to b. Works with a > b (falls instead of rises), as in the reference. */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Normalised ellipse distance: < 1 inside, 1 on the edge. `rot` in radians. */
export function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number, rot = 0): number {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = (dx * c + dy * s) / rx;
  const ly = (-dx * s + dy * c) / ry;
  return Math.sqrt(lx * lx + ly * ly);
}

/** Distance (in cells) from (x, y) to the segment a→b. */
export function capsule(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const px = x - ax;
  const py = y - ay;
  const sx = bx - ax;
  const sy = by - ay;
  const ll = sx * sx + sy * sy;
  const t = ll > 0 ? clamp01((px * sx + py * sy) / ll) : 0;
  const dx = px - sx * t;
  const dy = py - sy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Soft coverage across a shape edge: 1 well inside, 0 outside `outer`. */
export const softCov = (e: number, inner = 0.84, outer = 1.12): number => smooth(outer, inner, e);

/** Glyph-only cells available in every palette's atlas row (index = column). */
export const LINE_GLYPHS = ['.', ':', '-', '|', '/', '\\', 'o', '·', '=', '+', "'"] as const;
export type LineGlyph = (typeof LINE_GLYPHS)[number];
export const G: Record<LineGlyph, number> = Object.fromEntries(LINE_GLYPHS.map((g, i) => [g, i])) as Record<
  LineGlyph,
  number
>;

/** Line glyph matching a screen-space angle (radians, y down). */
export function lineGlyph(angle: number): '-' | '\\' | '|' | '/' {
  const o = ((angle % Math.PI) + Math.PI) % Math.PI; // 0..π
  const P = Math.PI;
  if (o < P / 8 || o > (7 * P) / 8) return '-';
  if (o < (3 * P) / 8) return '\\';
  if (o < (5 * P) / 8) return '|';
  return '/';
}

/**
 * World offset (dx, dy) in px → local (u, v) in cells at scale 1.
 * Writes into `out` to avoid allocation.
 */
export function toLocal(
  dx: number,
  dy: number,
  heading: number,
  cell: number,
  scale: number,
  out: { u: number; v: number },
): void {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const k = cell * scale;
  out.u = (dx * -fy + dy * fx) / k;
  out.v = -(dx * fx + dy * fy) / k;
}

/**
 * Anti-aliased coverage of a round part (capsule / circle) of radius r at distance d, both in cells.
 * Approximates how much of a 1-cell box the part fills, so parts thinner than a cell come out as a
 * continuous line of partial-alpha tiles instead of a broken staircase. Wide parts keep a soft rim.
 */
export function aaCov(d: number, r: number): number {
  const peak = r < 0.5 ? 0.45 + 1.1 * r : 1; // a thin part never fills a whole cell
  return peak * clamp01(r + 0.55 - d);
}
