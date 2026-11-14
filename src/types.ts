export type AnimalId =
  | 'butterfly'
  | 'jellyfish'
  | 'dragonfly'
  | 'koi'
  | 'frog'
  | 'crane'
  | 'crab'
  | 'firefly'
  | 'moth'
  | 'sardine'
  | 'ant'
  | 'snail'
  | 'snake'
  | 'octopus'
  | 'manta'
  | 'spider'
  | 'bat'
  | 'whale';

export interface Tweaks {
  density: number; // animal count multiplier, 0.25–2, default 1
  speed: number; // global speed multiplier, 0.25–2, default 1
  cellSize: number; // CSS px per grid cell, 6–16, default 9
  bgDensity: number; // fraction of background cells with a glyph, 0–1, default 0.32
  trails: boolean; // dragonfly + jellyfish trails, default true
}

export const DEFAULT_TWEAKS: Tweaks = { density: 1, speed: 1, cellSize: 9, bgDensity: 0.32, trails: true };

export interface AsciiFieldOptions {
  host: HTMLElement; // area to cover; receives clicks. Must be position: relative.
  animal?: AnimalId;
  theme?: 'dark' | 'light';
  ui?: { switcher?: 'top' | 'bottom' | false; tweaks?: boolean; hint?: boolean };
  tweaks?: Partial<Tweaks>;
  persist?: boolean;
  dimSelector?: string; // default '[data-af-dim]'
  seed?: number;
  debug?: boolean;
  /** Demo/QA: fixed entity count instead of the area formula. */
  count?: number;
  /** Demo/QA: simulate this many seconds at 1/60 s, render one still frame, run no loop. */
  stillT?: number;
}

export interface AsciiField {
  setAnimal(id: AnimalId): void;
  setTweaks(t: Partial<Tweaks>): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}
