/** fps / entities / cells / frame-time overlay, refreshed 4× a second. */
export class DebugOverlay {
  readonly el = document.createElement('div');
  private fps = 60;
  private acc = 0;

  constructor(host: HTMLElement) {
    this.el.className = 'af-debug af-ui';
    this.el.setAttribute('aria-hidden', 'true');
    host.append(this.el);
  }

  update(dt: number, info: { animal: string; entities: number; panicked: number; cells: number; ms: number; grid: string }): void {
    if (dt > 0) this.fps = this.fps * 0.9 + (1 / dt) * 0.1;
    this.acc += dt;
    if (this.acc < 0.25 && dt > 0) return;
    this.acc = 0;
    this.el.textContent =
      `fps ${this.fps.toFixed(0)}\n${info.animal} ${info.entities} (panicked ${info.panicked})\ncells ${info.cells}\n` +
      `frame ${info.ms.toFixed(2)} ms\ngrid ${info.grid}`;
  }

  destroy(): void {
    this.el.remove();
  }
}
