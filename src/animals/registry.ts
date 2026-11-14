import type { AnimalId } from '../types';
import type { AnimalDef } from './types';
import type { PaletteTable } from '../engine/palettes';
import { butterfly } from './butterfly';
import { koi } from './koi';
import { jellyfish } from './jellyfish';
import { dragonfly } from './dragonfly';
import { frog } from './frog';
import { crane } from './crane';
import { crab } from './crab';
import { firefly } from './firefly';
import { moth } from './moth';
import { sardine } from './sardine';
import { antDef } from './ant';
import { snail } from './snail';

export const ANIMALS: AnimalDef[] = [butterfly, jellyfish, dragonfly, koi, frog, crane, crab, firefly, moth, sardine, antDef, snail];

export const getAnimal = (id: AnimalId | string | undefined): AnimalDef | undefined =>
  ANIMALS.find((a) => a.id === id);

/** Register every animal's ramps in the palette table and fill `def.pal`. */
export const FOOD_PALETTE = ['#fde68a', '#fde68a'];
export const CRUMB_PALETTE = ['#2a1e0e', '#6b5230', '#c9a96e', '#f3e2b8'];

/** Registers every animal's ramps; returns the shared [food, crumb] palette indices. */
export function registerPalettes(table: PaletteTable): [number, number] {
  for (const a of ANIMALS) {
    for (const [name, stops] of Object.entries(a.palettes)) a.pal[name] = table.add(`${a.id}.${name}`, stops, a.lineShade?.[name] ?? 0.7);
  }
  return [table.add('food', FOOD_PALETTE, 1), table.add('crumb', CRUMB_PALETTE)];
}
