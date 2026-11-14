/** rAF loop with dt clamping and pause/resume (§8.1). `step` receives unscaled seconds. */
export class Loop {
  private raf = 0;
  private last = 0;
  running = false;

  constructor(private step: (dt: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(Math.max(0, now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.step(dt);
    if (this.running) this.raf = requestAnimationFrame(this.frame);
  };
}
