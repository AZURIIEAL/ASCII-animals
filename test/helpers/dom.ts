/**
 * A deliberately tiny DOM stub. The module has zero runtime dependencies, and we
 * keep the test deps to vitest alone, so there is no jsdom here — just enough
 * surface for createAsciiField() to mount and tear down.
 */

export interface Counters {
  listeners: number;
  rafScheduled: number;
  rafCancelled: number;
  observers: number;
  disconnected: number;
}

/** Ids currently attached to the fake document, so getElementById stays honest. */
const registeredIds = new Set<string>();

export class FakeElement {
  ownerDocument: unknown = null;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = '';
  id = '';
  textContent = '';
  style: Record<string, string> = {};
  width = 0;
  height = 0;
  clientWidth = 1280;
  clientHeight = 720;
  attrs = new Map<string, string>();
  listeners: Array<[string, unknown]> = [];

  constructor(
    readonly tagName: string,
    private readonly counters: Counters,
  ) {}

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.id) registeredIds.delete(this.id);
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }

  closest(): null {
    return null;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }

  getContext(): null {
    return null;
  }

  addEventListener(type: string, fn: unknown): void {
    this.listeners.push([type, fn]);
    this.counters.listeners++;
  }

  removeEventListener(type: string, fn: unknown): void {
    const i = this.listeners.findIndex(([t, f]) => t === type && f === fn);
    if (i >= 0) {
      this.listeners.splice(i, 1);
      this.counters.listeners--;
    }
  }

  /** All descendants (plus self) whose class starts with "af-". */
  afNodes(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      if (el.className.startsWith('af-')) out.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

export interface FakeEnv {
  host: FakeElement;
  counters: Counters;
  restore(): void;
  /** Runs one animation frame. */
  tick(ms?: number): void;
  pendingFrames(): number;
}

export function installFakeDom(): FakeEnv {
  const counters: Counters = {
    listeners: 0,
    rafScheduled: 0,
    rafCancelled: 0,
    observers: 0,
    disconnected: 0,
  };
  const g = globalThis as Record<string, unknown>;
  const saved = { ...g };

  const head = new FakeElement('head', counters);
  const registry = new Map<string, FakeElement>();

  const doc = {
    hidden: false,
    head,
    defaultView: undefined as unknown,
    createElement: (tag: string) => new FakeElement(tag, counters),
    getElementById: (id: string) => (registeredIds.has(id) ? registry.get(id) ?? null : null),
    addEventListener: (type: string, fn: unknown) => {
      docListeners.push([type, fn]);
      counters.listeners++;
    },
    removeEventListener: (type: string, fn: unknown) => {
      const i = docListeners.findIndex(([t, f]) => t === type && f === fn);
      if (i >= 0) {
        docListeners.splice(i, 1);
        counters.listeners--;
      }
    },
  };
  const docListeners: Array<[string, unknown]> = [];

  // Anything appended to <head> with an id becomes findable, as in a real document.
  const headAppend = head.appendChild.bind(head);
  head.appendChild = (child: FakeElement): FakeElement => {
    if (child.id) {
      registry.set(child.id, child);
      registeredIds.add(child.id);
    }
    return headAppend(child);
  };

  let frames: Array<(t: number) => void> = [];
  let nextId = 1;
  const ids = new Map<number, (t: number) => void>();

  const win = {
    location: { search: '' },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };
  doc.defaultView = win;

  class FakeObserver {
    constructor() {
      counters.observers++;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      counters.disconnected++;
    }
  }

  g.document = doc;
  g.window = win;
  g.devicePixelRatio = 2;
  g.ResizeObserver = FakeObserver;
  g.IntersectionObserver = FakeObserver;
  g.DOMRect = class {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly width = 0,
      readonly height = 0,
    ) {}
    get left(): number {
      return this.x;
    }
    get top(): number {
      return this.y;
    }
  };
  g.requestAnimationFrame = (fn: (t: number) => void): number => {
    counters.rafScheduled++;
    const id = nextId++;
    ids.set(id, fn);
    frames.push(fn);
    return id;
  };
  g.cancelAnimationFrame = (id: number): void => {
    counters.rafCancelled++;
    const fn = ids.get(id);
    ids.delete(id);
    frames = frames.filter((f) => f !== fn);
  };

  const host = new FakeElement('section', counters);
  host.ownerDocument = doc as never;

  let now = 0;
  return {
    host,
    counters,
    tick(ms = 16): void {
      now += ms;
      const due = frames;
      frames = [];
      for (const fn of due) fn(now);
    },
    pendingFrames: () => frames.length,
    restore(): void {
      for (const k of [
        'document',
        'window',
        'devicePixelRatio',
        'ResizeObserver',
        'IntersectionObserver',
        'DOMRect',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ]) {
        if (k in saved) g[k] = saved[k];
        else delete g[k];
      }
    },
  };
}
