import type { AnimalId } from '../types';
import { butterfly } from './butterfly';
import type { AnimalDef } from './types';

/**
 * Animals land here as they are built. Milestones 3 and 4 add the other six;
 * callers fall back to the butterfly until then.
 */
export const ANIMALS: Partial<Record<AnimalId, AnimalDef>> = {
  butterfly,
};

export function getAnimal(id: AnimalId): AnimalDef {
  return ANIMALS[id] ?? butterfly;
}

export const implementedAnimals = (): AnimalId[] => Object.keys(ANIMALS) as AnimalId[];
