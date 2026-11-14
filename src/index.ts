import { DEFAULT_TWEAKS, type AsciiField, type AsciiFieldOptions, type Tweaks } from './types';
import { ANIMALS, getAnimal, registerPalettes } from './animals/registry';
import { buildAtlas, type Atlas } from './engine/atlas';
import { Background } from './engine/background';
import { CellBuffer } from './engine/cellBuffer';
import { computeDim, dimRects } from './engine/dimMask';
import { effectiveCell, makeGrid, type Grid } from './engine/grid';
import { listenClicks } from './engine/input';
import { Loop } from './engine/loop';
import { PaletteTable } from './engine/palettes';
import { drawFrame } from './engine/renderer';
import { Trails } from './engine/trails';
import { World } from './engine/world';
import { mulberry32 } from './math/rng';
import { DebugOverlay } from './ui/debug';
import { acquireStyles } from './ui/styles';

export type { AnimalId, AsciiField, AsciiFieldOptions, Tweaks } from './types';

const STILL_STEP = 1 / 60;

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

  const palettes = new PaletteTable();
  const foodPal = registerPalettes(palettes);
  const buf = new CellBuffer();
  const trails = new Trails();
  const bg = new Background(mulberry32(seed ^ 0x5bd1e995), opts.theme ?? 'dark', tweaks.bgDensity);
  const world = new World(getAnimal(opts.animal) ?? ANIMALS[0], mulberry32(seed), buf, trails, seed);
  world.density = tweaks.density;
  world.countOverride = opts.count ?? 0;
  world.foodPal = foodPal;
  world.trailsOn = tweaks.trails;
  const debug = opts.debug ? new DebugOverlay(host) : null;
  if (opts.debug) (host as HTMLElement & { __afWorld?: World }).__afWorld = world; // QA hook

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
    atlas = buildAtlas(palettes.list, grid.cell, grid.dpr);
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
  if (stillT !== null) {
    const steps = Math.round(stillT / STILL_STEP);
    for (let i = 0; i < steps; i++) world.update(STILL_STEP * tweaks.speed);
    draw();
    debug?.update(0, {
      animal: world.def.id,
      entities: world.entities.length,
      panicked: world.entities.filter((e) => e.panic > 0).length,
      cells: buf.occN,
      ms: lastMs,
      grid: `${grid.cols}×${grid.rows} @${grid.cell}px`,
    });
  } else draw();

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

  syncRunning();

  return {
    setAnimal(id) {
      const def = getAnimal(id);
      if (!def || def === world.def) return;
      world.setAnimal(def);
      if (!loop.running) draw();
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
      loop.stop();
      clearTimeout(rT);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      unlisten();
      debug?.destroy();
      delete (host as HTMLElement & { __afWorld?: World }).__afWorld;
      canvas.remove();
      releaseStyles();
    },
  };
}
