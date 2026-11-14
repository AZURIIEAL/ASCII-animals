import { DEFAULT_TWEAKS, type AnimalId, type AsciiField, type AsciiFieldOptions, type Tweaks } from './types';
import { CRUMB_PAL, FOOD_PAL, isAnimalId, loadAnimal, PALETTES } from './animals/registry';
import type { AnimalDef } from './animals/types';
import { buildAtlas, type Atlas } from './engine/atlas';
import { Background } from './engine/background';
import { CellBuffer } from './engine/cellBuffer';
import { computeDim, dimRects } from './engine/dimMask';
import { effectiveCell, makeGrid, type Grid } from './engine/grid';
import { listenClicks, listenPointer } from './engine/input';
import { Loop } from './engine/loop';
import { drawFrame } from './engine/renderer';
import { Trails } from './engine/trails';
import { World } from './engine/world';
import { mulberry32 } from './math/rng';
import { DebugOverlay } from './ui/debug';
import { acquireStyles } from './ui/styles';

export type { AnimalId, AsciiField, AsciiFieldOptions, Tweaks } from './types';

const STILL_STEP = 1 / 60;

/** Placeholder until the first animal's chunk has loaded: no entities, background only. */
const NO_ANIMAL: AnimalDef = {
  id: 'butterfly',
  label: '',
  dot: '',
  baseCount: 0,
  minCount: 0,
  maxCount: 0,
  radius: 1,
  clickMode: 'scatter',
  edge: 'none',
  palettes: {},
  pal: {},
  spawn: () => {
    throw new Error('no animal loaded');
  },
  update: () => {},
  render: () => {},
};

export function createAsciiField(opts: AsciiFieldOptions): AsciiField {
  const host = opts.host;
  const tweaks: Tweaks = { ...DEFAULT_TWEAKS, ...opts.tweaks };
  const seed = opts.seed ?? 7;
  const dimSelector = opts.dimSelector ?? '[data-af-dim]';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Still mode: QA screenshots (?t=) or reduced motion. Simulate, draw one frame, run no loop.
  const stillT = opts.stillT ?? (reduced ? 2 : null);
  const releaseStyles = acquireStyles();

  const canvas = document.createElement('canvas');
  canvas.className = 'af-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const buf = new CellBuffer();
  const trails = new Trails();
  const bg = new Background(mulberry32(seed ^ 0x5bd1e995), opts.theme ?? 'dark', tweaks.bgDensity);
  const world = new World(NO_ANIMAL, mulberry32(seed), buf, trails, seed);
  world.density = tweaks.density;
  world.countOverride = opts.count ?? 0;
  world.foodPal = FOOD_PAL;
  world.crumbPal = CRUMB_PAL;
  world.trailsOn = tweaks.trails;
  const debug = opts.debug ? new DebugOverlay(host) : null;
  // QA hooks (debug only): the world and a redraw, for scripted close-ups.
  type QaHost = HTMLElement & { __afWorld?: World; __afDraw?: () => void };
  if (opts.debug) (host as QaHost).__afWorld = world;

  let grid: Grid = makeGrid(1, 1, tweaks.cellSize, 1);
  let atlas: Atlas | null = null;
  let dim: Float32Array = new Float32Array(1);
  let lastMs = 0;

  function layout(): void {
    const w = host.clientWidth;
    const h = host.clientHeight;
    grid = makeGrid(w, h, effectiveCell(w, tweaks.cellSize), window.devicePixelRatio);
    canvas.width = Math.round(grid.w * grid.dpr);
    canvas.height = Math.round(grid.h * grid.dpr);
    buf.resize(grid.cols, grid.rows);
    trails.resize(grid.cols, grid.rows);
    bg.density = tweaks.bgDensity;
    bg.build(grid);
    atlas = buildAtlas(PALETTES.list, grid.cell, grid.dpr);
    dim = computeDim(grid, dimRects(host, dimSelector));
    world.setGrid(grid);
    world.syncCount();
  }

  function draw(): void {
    if (!atlas) return;
    const t0 = performance.now();
    world.render();
    drawFrame(ctx, grid, bg.canvas, atlas, buf, trails, dim, tweaks.trails);
    lastMs = performance.now() - t0;
  }

  if (opts.debug) (host as QaHost).__afDraw = () => draw();

  const loop = new Loop((rawDt) => {
    const t0 = performance.now();
    const dt = rawDt * tweaks.speed;
    world.update(dt);
    bg.shimmer(dt);
    draw();
    debug?.update(rawDt, {
      animal: world.def.id,
      entities: world.entities.length,
      panicked: world.entities.filter((e) => e.panic > 0).length,
      cells: buf.occN,
      ms: performance.now() - t0,
      grid: `${grid.cols}×${grid.rows} @${grid.cell}px`,
    });
  });

  // ---------- run state ----------
  let userPaused = false;
  let onScreen = true;
  function syncRunning(): void {
    const want = stillT === null && !userPaused && onScreen && !document.hidden;
    if (want) loop.start();
    else loop.stop();
  }

  layout();
  draw(); // background right away; animals arrive when their chunk has loaded

  let destroyed = false;
  let loadToken = 0;
  let simulated = false;
  let wanted: AnimalId | null = null; // the animal most recently asked for (it may still be loading)
  /** Load an animal's chunk (cached), then swap it in. Later calls win over earlier ones. */
  function show(id: AnimalId): void {
    wanted = id;
    const token = ++loadToken;
    loadAnimal(id).then(
      (def) => {
        if (destroyed || token !== loadToken) return;
        atlas = buildAtlas(PALETTES.list, grid.cell, grid.dpr); // now includes this animal's ramps
        world.setAnimal(def);
        if (stillT !== null && !simulated) {
          // Still mode (QA screenshots / reduced motion): simulate, then draw one frame.
          simulated = true;
          const steps = Math.round(stillT / STILL_STEP);
          for (let i = 0; i < steps; i++) world.update(STILL_STEP * tweaks.speed);
        }
        draw();
        canvas.dataset.ready = def.id;
        debug?.update(0, {
          animal: world.def.id,
          entities: world.entities.length,
          panicked: world.entities.filter((e) => e.panic > 0).length,
          cells: buf.occN,
          ms: lastMs,
          grid: `${grid.cols}×${grid.rows} @${grid.cell}px`,
        });
      },
      (err) => console.warn('[ascii-field] could not load animal', id, err),
    );
  }
  show(isAnimalId(opts.animal) ? opts.animal : 'butterfly');

  // ---------- observers & listeners ----------
  let rT = 0;
  let lastW = grid.w;
  let lastH = grid.h;
  const ro = new ResizeObserver(() => {
    clearTimeout(rT);
    rT = window.setTimeout(() => {
      if (host.clientWidth !== lastW || host.clientHeight !== lastH) layout();
      else dim = computeDim(grid, dimRects(host, dimSelector), dim); // only the dim targets moved
      lastW = grid.w;
      lastH = grid.h;
      draw();
    }, 100);
  });
  ro.observe(host);
  host.querySelectorAll(dimSelector).forEach((el) => ro.observe(el));

  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      onScreen = e.isIntersecting && e.intersectionRatio >= 0.01;
      syncRunning();
    },
    { threshold: [0, 0.01] },
  );
  io.observe(host);

  const onVisibility = (): void => syncRunning();
  document.addEventListener('visibilitychange', onVisibility);

  const unlisten = listenClicks(host, (x, y) => {
    world.click(x, y);
    if (!loop.running) draw(); // still mode: show the ripple / new positions
  });

  const unlistenPointer = listenPointer(host, (x, y, active) => {
    world.pointer.x = x;
    world.pointer.y = y;
    world.pointer.active = active;
  });

  syncRunning();

  return {
    setAnimal(id) {
      if (!isAnimalId(id) || id === wanted) return;
      show(id); // M5 adds fly-out / fly-in transitions
    },
    setTweaks(t) {
      const relayout =
        (t.cellSize !== undefined && t.cellSize !== tweaks.cellSize) ||
        (t.bgDensity !== undefined && t.bgDensity !== tweaks.bgDensity);
      Object.assign(tweaks, t);
      world.density = tweaks.density;
      world.trailsOn = tweaks.trails;
      if (relayout) layout();
      else world.syncCount();
      if (!tweaks.trails) trails.clear();
      if (!loop.running) draw();
    },
    pause() {
      userPaused = true;
      syncRunning();
    },
    resume() {
      userPaused = false;
      syncRunning();
    },
    destroy() {
      destroyed = true;
      loop.stop();
      clearTimeout(rT);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      unlisten();
      unlistenPointer();
      debug?.destroy();
      delete (host as QaHost).__afWorld;
      delete (host as QaHost).__afDraw;
      canvas.remove();
      releaseStyles();
    },
  };
}
