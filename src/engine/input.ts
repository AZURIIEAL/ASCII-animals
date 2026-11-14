const IGNORE_SELECTOR =
  'a, button, input, textarea, select, label, [role="button"], [data-af-ignore]';

export interface PointerHandlers {
  onClick(x: number, y: number): void;
  onMove?(x: number, y: number): void;
}

/**
 * Pointer handling on the host. The canvas itself is pointer-events: none, so
 * links and buttons above it keep working; we never call preventDefault, so
 * touch scrolling is untouched.
 */
export class Input {
  private readonly down: (ev: PointerEvent) => void;
  private readonly move: ((ev: PointerEvent) => void) | null;

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: PointerHandlers,
    /** Nodes belonging to the module's own UI; clicks inside them are ignored. */
    private readonly ownUi: () => readonly HTMLElement[],
  ) {
    this.down = (ev: PointerEvent): void => {
      if (ev.button !== 0) return;
      if (this.shouldIgnore(ev.target)) return;
      const p = this.toLocal(ev.clientX, ev.clientY);
      this.handlers.onClick(p.x, p.y);
    };
    this.move = handlers.onMove
      ? (ev: PointerEvent): void => {
          const p = this.toLocal(ev.clientX, ev.clientY);
          handlers.onMove?.(p.x, p.y);
        }
      : null;
    host.addEventListener('pointerdown', this.down);
    if (this.move) host.addEventListener('pointermove', this.move);
  }

  private readonly point = { x: 0, y: 0 };

  toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    this.point.x = clientX - r.left;
    this.point.y = clientY - r.top;
    return this.point;
  }

  private shouldIgnore(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest(IGNORE_SELECTOR)) return true;
    for (const node of this.ownUi()) if (node.contains(target)) return true;
    return false;
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.down);
    if (this.move) this.host.removeEventListener('pointermove', this.move);
  }
}
