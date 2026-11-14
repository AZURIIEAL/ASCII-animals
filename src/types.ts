export type AnimalId =
  | 'butterfly'
  | 'jellyfish'
  | 'dragonfly'
  | 'koi'
  | 'frog'
  | 'crane'
  | 'crab';

export const ANIMAL_IDS: readonly AnimalId[] = [
  'butterfly',
  'jellyfish',
  'dragonfly',
  'koi',
  'frog',
  'crane',
  'crab',
];

export interface Tweaks {
  /** animal count multiplier, 0.25–2 */
  density: number;
  /** global speed multiplier, 0.25–2 */
  speed: number;
  /** CSS px per grid cell, 8–18 */
  cellSize: number;
  /** fraction of background cells carrying a glyph, 0–1 */
  bgDensity: number;
  /** dragonfly + jellyfish trails */
  trails: boolean;
  /** filled cell + glyph, or glyph only */
  style: 'blocks' | 'glyphs';
}

export type Theme = 'dark' | 'light';

export interface AsciiFieldOptions {
  /** Area to cover; receives clicks. Must be position: relative. */
  host: HTMLElement;
  animal?: AnimalId;
  theme?: Theme;
  ui?: {
    switcher?: 'top' | 'bottom' | false;
    tweaks?: boolean;
    hint?: boolean;
  };
  tweaks?: Partial<Tweaks>;
  persist?: boolean;
  dimSelector?: string;
  /** deterministic RNG for tests */
  seed?: number;
  debug?: boolean;
}

export interface AsciiField {
  setAnimal(id: AnimalId): void;
  setTweaks(t: Partial<Tweaks>): void;
  pause(): void;
  resume(): void;
  /** Removes canvas, UI, styles, listeners and observers. */
  destroy(): void;
}

export const DEFAULT_TWEAKS: Tweaks = {
  density: 1,
  speed: 1,
  cellSize: 12,
  bgDensity: 0.55,
  trails: true,
  style: 'blocks',
};

export const TWEAK_RANGES = {
  density: [0.25, 2] as const,
  speed: [0.25, 2] as const,
  cellSize: [8, 18] as const,
  bgDensity: [0, 1] as const,
};

/** Clamps incoming tweaks to their documented ranges and drops unknown keys. */
export function sanitizeTweaks(base: Tweaks, patch: Partial<Tweaks> | undefined): Tweaks {
  const out: Tweaks = { ...base };
  if (!patch) return out;
  const num = (v: unknown, range: readonly [number, number], fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(range[1], Math.max(range[0], v))
      : fallback;
  out.density = num(patch.density, TWEAK_RANGES.density, out.density);
  out.speed = num(patch.speed, TWEAK_RANGES.speed, out.speed);
  out.cellSize = num(patch.cellSize, TWEAK_RANGES.cellSize, out.cellSize);
  out.bgDensity = num(patch.bgDensity, TWEAK_RANGES.bgDensity, out.bgDensity);
  if (typeof patch.trails === 'boolean') out.trails = patch.trails;
  if (patch.style === 'blocks' || patch.style === 'glyphs') out.style = patch.style;
  return out;
}
