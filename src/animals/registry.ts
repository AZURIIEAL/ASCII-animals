import type { AnimalId } from '../types';
import type { AnimalDef } from './types';
import type { PaletteTable } from '../engine/palettes';
import { butterfly } from './butterfly';

export const ANIMALS: AnimalDef[] = [butterfly];

export const getAnimal = (id: AnimalId | string | undefined): AnimalDef | undefined =>
  ANIMALS.find((a) => a.id === id);

/** Register every animal's ramps in the palette table and fill `def.pal`. */
export function registerPalettes(table: PaletteTable): void {
  for (const a of ANIMALS) {
    for (const [name, stops] of Object.entries(a.palettes)) a.pal[name] = table.add(`${a.id}.${name}`, stops);
  }
}
