import { DEFAULT_TWEAKS, type AsciiField, type AsciiFieldOptions, type Tweaks } from './types';
import { Background } from './engine/background';
import { effectiveCell, makeGrid, type Grid } from './engine/grid';
import { Loop } from './engine/loop';
import { mulberry32 } from './math/rng';
import { acquireStyles } from './ui/styles';

export type { AnimalId, AsciiField, AsciiFieldOptions, Tweaks } from './types';

export function createAsciiField(opts: AsciiFieldOptions): AsciiField {
  const host = opts.host;
  const tweaks: Tweaks = { ...DEFAULT_TWEAKS, ...opts.tweaks };
  const seed = opts.seed ?? 7;
  const releaseStyles = acquireStyles();

  const canvas = document.createElement('canvas');
  canvas.className = 'af-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const bg = new Background(mulberry32(seed ^ 0x5bd1e995), opts.theme ?? 'dark', tweaks.bgDensity);
  let grid: Grid = makeGrid(1, 1, 9, 1);

  function layout(): void {
    const w = host.clientWidth;
    const h = host.clientHeight;
    grid = makeGrid(w, h, effectiveCell(w, tweaks.cellSize), window.devicePixelRatio);
    canvas.width = Math.round(grid.w * grid.dpr);
    canvas.height = Math.round(grid.h * grid.dpr);
    bg.density = tweaks.bgDensity;
    bg.build(grid);
  }

  function draw(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg.canvas, 0, 0);
  }

  const loop = new Loop((dt) => {
    bg.shimmer(dt * tweaks.speed);
    draw();
  });

  layout();
  draw();
  loop.start();

  let rT = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(rT);
    rT = window.setTimeout(() => {
      layout();
      draw();
    }, 100);
  });
  ro.observe(host);

  return {
    setAnimal() {},
    setTweaks(t) {
      Object.assign(tweaks, t);
      layout();
      draw();
    },
    pause: () => loop.stop(),
    resume: () => loop.start(),
    destroy() {
      loop.stop();
      clearTimeout(rT);
      ro.disconnect();
      canvas.remove();
      releaseStyles();
    },
  };
}
