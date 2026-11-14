/** rAF loop with dt clamping and pause/resume. Pausing cancels the frame entirely. */
export class Loop {
  private rafId = 0;
  private last = 0;
  private running = false;
  /** Reasons the loop is held: hidden tab, off-screen host, manual pause. */
  private holds = new Set<string>();

  constructor(private readonly step: (dt: number) => void) {}

  get isRunning(): boolean {
    return this.running;
  }

  private readonly frame = (now: number): void => {
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(raw, 1 / 20);
    this.step(dt);
    if (this.running) this.rafId = requestAnimationFrame(this.frame);
  };

  start(): void {
    if (this.running || this.holds.size > 0) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  hold(reason: string): void {
    this.holds.add(reason);
    this.stop();
  }

  release(reason: string): void {
    this.holds.delete(reason);
    if (this.holds.size === 0) this.start();
  }

  get held(): boolean {
    return this.holds.size > 0;
  }
}
