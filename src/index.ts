import { Atlas } from './engine/atlas';
import { Background } from './engine/background';
import { DimMask } from './engine/dimMask';
import { deviceRatio } from './engine/grid';
import { Input } from './engine/input';
import { Loop } from './engine/loop';
import { Renderer } from './engine/renderer';
import { World } from './engine/world';
import { Persist } from './persist';
import { DebugOverlay } from './ui/debug';
import { injectStyles, releaseStyles } from './ui/styles';
import {
  sanitizeTweaks,
  type AnimalId,
  type AsciiField,
  type AsciiFieldOptions,
  type Theme,
  type Tweaks,
} from './types';

export type {
  AnimalId,
  AsciiField,
  AsciiFieldOptions,
  Tweaks,
} from './types';
export { DEFAULT_TWEAKS } from './types';

const RESIZE_DEBOUNCE = 100;

export function createAsciiField(opts: AsciiFieldOptions): AsciiField {
  const host = opts.host;
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;

  const persist = new Persist(opts.persist !== false);
  const theme: Theme = opts.theme ?? 'dark';
  const dimSelector = opts.dimSelector ?? '[data-af-dim]';
  const seed = opts.seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0);

  let tweaks: Tweaks = persist.tweaks(opts.tweaks);
  // Narrow hosts default to a smaller cell, unless a size was asked for explicitly.
  if (
    opts.tweaks?.cellSize === undefined &&
    persist.state.tweaks?.cellSize === undefined &&
    host.clientWidth < 768
  ) {
    tweaks = { ...tweaks, cellSize: 10 };
  }

  const animal: AnimalId = opts.animal ?? persist.state.animal ?? 'butterfly';

  injectStyles(doc);

  const canvas = doc.createElement('canvas');
  canvas.className = 'af-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });

  const createCanvas = (): HTMLCanvasElement => doc.createElement('canvas');

  const world = new World(tweaks, theme, animal, seed);
  const atlas = new Atlas(world.palette, createCanvas);
  const background = new Background(createCanvas, world.rng.fork());
  const renderer = ctx ? new Renderer(ctx, world.palette, atlas, background) : null;
  const mask = new DimMask();

  const debugOn =
    opts.debug === true ||
    (typeof win.location !== 'undefined' && win.location.search.includes('debug'));
  const debug = debugOn ? new DebugOverlay(doc) : null;
  if (debug) host.appendChild(debug.el);

  const reduceMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  const isReduced = (): boolean => reduceMotion?.matches === true;

  let destroyed = false;

  function layout(force = false): void {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    const dpr = deviceRatio();
    const changed = world.resize(w, h, tweaks.cellSize, dpr);
    if (!changed && !force) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    background.rebuild(world.grid, tweaks.bgDensity, theme);
    atlas.rebuild(world.grid.cell, dpr);
    rebuildMask();
  }

  function rebuildMask(): void {
    const hostRect = host.getBoundingClientRect();
    const rects: DOMRect[] = [];
    for (const el of dimTargets()) {
      const r = el.getBoundingClientRect();
      rects.push(
        new DOMRect(r.left - hostRect.left, r.top - hostRect.top, r.width, r.height),
      );
    }
    mask.build(world.grid, rects);
  }

  function dimTargets(): HTMLElement[] {
    try {
      return Array.from(host.querySelectorAll<HTMLElement>(dimSelector));
    } catch {
      return [];
    }
  }

  // --- frame ---------------------------------------------------------------
  let lastCells = 0;

  function step(dtRaw: number): void {
    const t0 = debug ? performance.now() : 0;
    const dt = dtRaw * tweaks.speed;
    world.update(dt);
    background.shimmer(world.grid, dtRaw, tweaks.bgDensity, theme);
    world.render();
    renderer?.draw(world.grid, world.buffer, world.trails, mask, tweaks, theme);
    if (debug) {
      lastCells = world.buffer.occupied();
      debug.sample(dtRaw, performance.now() - t0, world.entities.length, lastCells);
    }
  }

  const loop = new Loop(step);

  /** Reduced motion: no loop. Simulate 2 s so animals spread out, then one still frame. */
  function stillFrame(): void {
    const dt = 1 / 30;
    for (let i = 0; i < 60; i++) world.update(dt * tweaks.speed);
    world.render();
    renderer?.draw(world.grid, world.buffer, world.trails, mask, tweaks, theme);
  }

  function run(): void {
    if (destroyed) return;
    if (isReduced()) {
      loop.stop();
      stillFrame();
    } else {
      loop.release('reduced-motion');
    }
  }

  // --- observers and listeners --------------------------------------------
  let resizeTimer = 0;
  const resizeObserver = new ResizeObserver(() => {
    win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(() => {
      if (destroyed) return;
      layout();
      if (isReduced()) stillFrame();
    }, RESIZE_DEBOUNCE);
  });
  resizeObserver.observe(host);

  const dimObserver = new ResizeObserver(() => {
    if (!destroyed) rebuildMask();
  });
  for (const el of dimTargets()) dimObserver.observe(el);

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((en) => en.intersectionRatio >= 0.01);
      if (visible) {
        loop.release('offscreen');
        if (isReduced()) stillFrame();
      } else {
        loop.hold('offscreen');
      }
    },
    { threshold: [0, 0.01] },
  );
  intersectionObserver.observe(host);

  const onVisibility = (): void => {
    if (doc.hidden) loop.hold('hidden');
    else loop.release('hidden');
  };
  doc.addEventListener('visibilitychange', onVisibility);

  const onMotionChange = (): void => {
    if (isReduced()) {
      loop.hold('reduced-motion');
      stillFrame();
    } else {
      loop.release('reduced-motion');
    }
  };
  reduceMotion?.addEventListener?.('change', onMotionChange);

  const input = new Input(
    host,
    {
      onClick(x, y) {
        if (isReduced()) return;
        const clicks = (persist.state.clicks ?? 0) + 1;
        persist.patch({ clicks, hintDismissed: clicks >= 3 ? true : persist.state.hintDismissed });
        world.scatter({ x, y });
      },
    },
    () => (debug ? [debug.el] : []),
  );

  // --- boot ----------------------------------------------------------------
  layout();
  world.populate();
  if (isReduced()) {
    loop.hold('reduced-motion');
    stillFrame();
  } else {
    loop.start();
  }

  return {
    setAnimal(id: AnimalId): void {
      if (destroyed) return;
      world.setAnimal(id);
      persist.patch({ animal: id });
      if (isReduced()) stillFrame();
    },
    setTweaks(patch: Partial<Tweaks>): void {
      if (destroyed) return;
      const next = sanitizeTweaks(tweaks, patch);
      const cellChanged = next.cellSize !== tweaks.cellSize;
      const bgChanged = next.bgDensity !== tweaks.bgDensity;
      tweaks = next;
      world.tweaks = next;
      persist.patch({ tweaks: next });
      if (cellChanged) {
        layout(true);
      } else if (bgChanged) {
        background.rebuild(world.grid, next.bgDensity, theme);
      }
      if (!next.trails) world.trails.clear();
      if (isReduced()) stillFrame();
    },
    pause(): void {
      loop.hold('manual');
    },
    resume(): void {
      loop.release('manual');
      run();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      win.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      dimObserver.disconnect();
      intersectionObserver.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      reduceMotion?.removeEventListener?.('change', onMotionChange);
      input.destroy();
      canvas.remove();
      debug?.el.remove();
      releaseStyles(doc);
    },
  };
}
