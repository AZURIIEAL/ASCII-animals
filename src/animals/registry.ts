import type { AnimalId } from '../types';
import type { AnimalDef } from './types';
import { PaletteTable } from '../engine/palettes';

/**
 * Lazy animal registry. The core only carries this small metadata list; each animal's code is its
 * own chunk, fetched when it's first shown, which keeps the initial bundle small (spec: ≤ 25 KB gzip).
 */
export interface AnimalMeta {
  id: AnimalId;
  label: string;
  dot: string;
}

export const ANIMAL_META: AnimalMeta[] = [
  { id: 'butterfly', label: 'Butterfly', dot: '#449ad9' },
  { id: 'jellyfish', label: 'Jellyfish', dot: '#d57fe0' },
  { id: 'dragonfly', label: 'Dragonfly', dot: '#4fd39b' },
  { id: 'koi', label: 'Koi', dot: '#facc15' },
  { id: 'frog', label: 'Frog', dot: '#34b553' },
  { id: 'crane', label: 'Crane', dot: '#eef1f6' },
  { id: 'crab', label: 'Crab', dot: '#e2463b' },
  { id: 'firefly', label: 'Firefly', dot: '#d9f25a' },
  { id: 'moth', label: 'Moth', dot: '#b89a72' },
  { id: 'sardine', label: 'Sardines', dot: '#9cc3dc' },
  { id: 'ant', label: 'Ants', dot: '#a47158' },
  { id: 'octopus', label: 'Octopus', dot: '#ea8a64' },
  { id: 'manta', label: 'Manta ray', dot: '#7d9fbd' },
  { id: 'spider', label: 'Spider', dot: '#c27a2a' },
  { id: 'whale', label: 'Whale', dot: '#93b1c7' },
];

const LOADERS: Record<AnimalId, () => Promise<AnimalDef>> = {
  butterfly: () => import('./butterfly').then((m) => m.butterfly),
  jellyfish: () => import('./jellyfish').then((m) => m.jellyfish),
  dragonfly: () => import('./dragonfly').then((m) => m.dragonfly),
  koi: () => import('./koi').then((m) => m.koi),
  frog: () => import('./frog').then((m) => m.frog),
  crane: () => import('./crane').then((m) => m.crane),
  crab: () => import('./crab').then((m) => m.crab),
  firefly: () => import('./firefly').then((m) => m.firefly),
  moth: () => import('./moth').then((m) => m.moth),
  sardine: () => import('./sardine').then((m) => m.sardine),
  ant: () => import('./ant').then((m) => m.antDef),
  octopus: () => import('./octopus').then((m) => m.octopus),
  manta: () => import('./manta').then((m) => m.manta),
  spider: () => import('./spider').then((m) => m.spider),
  whale: () => import('./whale').then((m) => m.whale),
};

export const isAnimalId = (id: unknown): id is AnimalId => typeof id === 'string' && id in LOADERS;

export const FOOD_PALETTE = ['#fde68a', '#fde68a'];
export const CRUMB_PALETTE = ['#2a1e0e', '#6b5230', '#c9a96e', '#f3e2b8'];

/**
 * One palette table for the whole page: an animal's `pal` indices are global, so they must not depend
 * on which field instance loaded it first.
 */
export const PALETTES = new PaletteTable();
export const FOOD_PAL = PALETTES.add('food', FOOD_PALETTE, 1);
export const CRUMB_PAL = PALETTES.add('crumb', CRUMB_PALETTE);

/** Register an animal's ramps in `table` and fill `def.pal`. Idempotent. */
export function registerAnimal(def: AnimalDef, table: PaletteTable = PALETTES): void {
  for (const [name, stops] of Object.entries(def.palettes)) {
    def.pal[name] = table.add(`${def.id}.${name}`, stops, def.lineShade?.[name] ?? 0.7);
  }
}

const cache = new Map<AnimalId, Promise<AnimalDef>>();

/** Fetch (once) and register an animal. */
export function loadAnimal(id: AnimalId): Promise<AnimalDef> {
  let p = cache.get(id);
  if (!p) {
    p = LOADERS[id]().then((def) => {
      registerAnimal(def);
      return def;
    });
    cache.set(id, p);
  }
  return p;
}
