import { DEFAULT_TWEAKS, sanitizeTweaks, type AnimalId, type Tweaks } from './types';

export const STORAGE_KEY = 'af:v1';

export interface PersistedState {
  animal?: AnimalId;
  tweaks?: Partial<Tweaks>;
  hintDismissed?: boolean;
  clicks?: number;
}

/**
 * localStorage wrapper. Every call is guarded; if storage throws (private mode,
 * blocked cookies) we silently fall back to in-memory state.
 */
export class Persist {
  private memory: PersistedState = {};

  constructor(private readonly enabled: boolean) {
    if (enabled) this.memory = this.read();
  }

  private read(): PersistedState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as PersistedState;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  get state(): PersistedState {
    return this.memory;
  }

  tweaks(overrides: Partial<Tweaks> | undefined): Tweaks {
    return sanitizeTweaks(sanitizeTweaks(DEFAULT_TWEAKS, this.memory.tweaks), overrides);
  }

  patch(next: PersistedState): void {
    this.memory = { ...this.memory, ...next };
    if (!this.enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memory));
    } catch {
      /* in-memory only */
    }
  }
}
