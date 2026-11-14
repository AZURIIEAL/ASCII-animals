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

export const ANIMALS: AnimalDef[] = [butterfly, jellyfish, dragonfly, koi, frog, crane, crab];

export const getAnimal = (id: AnimalId | string | undefined): AnimalDef | undefined =>
  ANIMALS.find((a) => a.id === id);

/** Register every animal's ramps in the palette table and fill `def.pal`. */
export const FOOD_PALETTE = ['#fde68a', '#fde68a'];

export function registerPalettes(table: PaletteTable): number {
  for (const a of ANIMALS) {
    for (const [name, stops] of Object.entries(a.palettes)) a.pal[name] = table.add(`${a.id}.${name}`, stops, a.lineShade?.[name] ?? 0.7);
  }
  return table.add('food', FOOD_PALETTE, 1);
}
