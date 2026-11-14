/** fps / entity count / frame time overlay, shown with `debug: true` or `?debug`. */
export class DebugOverlay {
  readonly el: HTMLElement;
  private readonly samples: number[] = [];
  private acc = 0;
  private frames = 0;
  private fps = 0;

  constructor(doc: Document) {
    this.el = doc.createElement('div');
    this.el.className = 'af-debug';
    this.el.setAttribute('aria-hidden', 'true');
  }

  sample(dt: number, frameMs: number, entities: number, cells: number): void {
    this.samples.push(frameMs);
    if (this.samples.length > 180) this.samples.shift();
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.acc = 0;
      this.frames = 0;
      const sorted = [...this.samples].sort((a, b) => a - b);
      const avg = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
      this.el.textContent =
        `${this.fps.toFixed(0)} fps\n` +
        `entities ${entities}\n` +
        `frame avg ${avg.toFixed(2)} ms\n` +
        `frame p95 ${p95.toFixed(2)} ms\n` +
        `cells ${cells}`;
    }
  }
}
