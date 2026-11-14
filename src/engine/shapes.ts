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

/**
 * Signed distance (cells) from (px, py) to the triangle a-b-c: negative inside.
 * For sharp-cornered shapes such as moth forewings and manta wings.
 */
export function sdTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e2x = ax - cx;
  const e2y = ay - cy;
  const v0x = px - ax;
  const v0y = py - ay;
  const v1x = px - bx;
  const v1y = py - by;
  const v2x = px - cx;
  const v2y = py - cy;
  const t0 = clamp01((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y));
  const t1 = clamp01((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y));
  const t2 = clamp01((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y));
  const q0x = v0x - e0x * t0;
  const q0y = v0y - e0y * t0;
  const q1x = v1x - e1x * t1;
  const q1y = v1y - e1y * t1;
  const q2x = v2x - e2x * t2;
  const q2y = v2y - e2y * t2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0 = q0x * q0x + q0y * q0y;
  const d1 = q1x * q1x + q1y * q1y;
  const d2 = q2x * q2x + q2y * q2y;
  const c0 = s * (v0x * e0y - v0y * e0x);
  const c1 = s * (v1x * e1y - v1y * e1x);
  const c2 = s * (v2x * e2y - v2y * e2x);
  const d = Math.min(d0, d1, d2);
  const inside = Math.min(c0, c1, c2);
  return -Math.sqrt(d) * Math.sign(inside);
}

/** Coverage from a signed distance (cells, negative inside), anti-aliased over about one cell. */
export const sdCov = (sd: number): number => clamp01(0.5 - sd);
