// Every animal, statically imported. For tests and tools only: the field itself loads animals lazily
// through ./registry so the initial bundle stays small.
import type { AnimalDef } from './types';
import { PaletteTable } from '../engine/palettes';
import { registerAnimal, FOOD_PALETTE, CRUMB_PALETTE } from './registry';
import { butterfly } from './butterfly';
import { jellyfish } from './jellyfish';
import { dragonfly } from './dragonfly';
import { koi } from './koi';
import { frog } from './frog';
import { crane } from './crane';
import { crab } from './crab';
import { firefly } from './firefly';
import { moth } from './moth';
import { sardine } from './sardine';
import { antDef } from './ant';
import { snail } from './snail';
import { snake } from './snake';
import { octopus } from './octopus';
import { manta } from './manta';
import { spider } from './spider';
import { bat } from './bat';
import { whale } from './whale';

export const ANIMALS: AnimalDef[] = [
  butterfly,
  jellyfish,
  dragonfly,
  koi,
  frog,
  crane,
  crab,
  firefly,
  moth,
  sardine,
  antDef,
  snail,
  snake,
  octopus,
  manta,
  spider,
  bat,
  whale,
];

/** Register every animal's ramps in `table`; returns the [food, crumb] palette indices. */
export function registerPalettes(table: PaletteTable): [number, number] {
  for (const a of ANIMALS) registerAnimal(a, table);
  return [table.add('food', FOOD_PALETTE, 1), table.add('crumb', CRUMB_PALETTE)];
}
