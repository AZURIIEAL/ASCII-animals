import type { Theme } from '../types';

/** Glyph table. Index 0 is reserved for "no glyph". */
export const GLYPHS = ' .,:;\'`-_=+|/\\#*oO%@xX^~"()[]{}<>'.split('');

const glyphIndexCache = new Map<string, number>();

export function glyphIndex(ch: string): number {
  const cached = glyphIndexCache.get(ch);
  if (cached !== undefined) return cached;
  let i = GLYPHS.indexOf(ch);
  if (i < 0) i = GLYPHS.indexOf('#');
  glyphIndexCache.set(ch, i);
  return i;
}

export const MAX_COLORS = 64;

/**
 * One global colour table, shared by every animal. Index 0 means "empty cell",
 * so the buffer can be cleared with a single fill(0).
 */
export class Palette {
  /** CSS colour per index; [0] is a placeholder. */
  readonly colors: string[] = ['#000000'];
  /** Lighter tint of each colour, used for the glyph on top of a filled block. */
  readonly tints: string[] = ['#000000'];
  private readonly index = new Map<string, number>();
  private theme: Theme;

  constructor(theme: Theme = 'dark') {
    this.theme = theme;
  }

  /** Registers a colour (idempotent) and returns its palette index. */
  register(css: string): number {
    const existing = this.index.get(css);
    if (existing !== undefined) return existing;
    if (this.colors.length >= MAX_COLORS) return 1;
    const i = this.colors.length;
    this.index.set(css, i);
    this.colors.push(themed(css, this.theme));
    this.tints.push(lighten(themed(css, this.theme), 0.35));
    return i;
  }

  /** Re-derives every registered colour for a new theme. Indices stay stable. */
  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    for (const [css, i] of this.index) {
      this.colors[i] = themed(css, theme);
      this.tints[i] = lighten(this.colors[i], 0.35);
    }
  }

  get size(): number {
    return this.colors.length;
  }
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(css: string): Rgb {
  let h = css.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = ({ r, g, b }: Rgb): string =>
  '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);

export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/** Light theme keeps the hue but drops lightness ~20%, so animals read on white. */
export function themed(css: string, theme: Theme): string {
  if (theme === 'dark') return css;
  const [h, s, l] = rgbToHsl(parseHex(css));
  return toHex(hslToRgb(h, s, Math.max(0.08, l - 0.2)));
}

export function lighten(css: string, amount: number): string {
  const [h, s, l] = rgbToHsl(parseHex(css));
  return toHex(hslToRgb(h, s, Math.min(1, l + (1 - l) * amount)));
}
