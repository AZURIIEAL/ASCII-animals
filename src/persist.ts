import type { AnimalId, Tweaks } from './types';

/** Saved choices (§11). Every storage call is wrapped: storage can be missing, blocked or full. */
export interface Saved {
  animal?: AnimalId;
  tweaks?: Partial<Tweaks>;
  hintDismissed?: boolean;
}

const KEY = 'af:v1';

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Saved) : {};
  } catch {
    return {};
  }
}

export function save(patch: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSaved(), ...patch }));
  } catch {
    /* storage unavailable: choices just won't persist */
  }
}
