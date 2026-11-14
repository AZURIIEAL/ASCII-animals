export const IGNORE_SELECTOR = 'a, button, input, textarea, select, label, [role="button"], [data-af-ignore], .af-ui';

/**
 * Primary-button pointerdown on the host → onClick(x, y) in host px.
 * Links, buttons, form controls and the module's own UI are ignored. Never preventDefault.
 */
export function listenClicks(host: HTMLElement, onClick: (x: number, y: number) => void): () => void {
  const handler = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    const target = ev.target;
    if (target instanceof Element && target.closest(IGNORE_SELECTOR)) return;
    const r = host.getBoundingClientRect();
    onClick(ev.clientX - r.left - host.clientLeft, ev.clientY - r.top - host.clientTop);
  };
  host.addEventListener('pointerdown', handler);
  return () => host.removeEventListener('pointerdown', handler);
}

/** Pointer position over the host (for hover-aware animals). Listens on the host only. */
export function listenPointer(host: HTMLElement, onMove: (x: number, y: number, active: boolean) => void): () => void {
  const move = (ev: PointerEvent): void => {
    const r = host.getBoundingClientRect();
    onMove(ev.clientX - r.left - host.clientLeft, ev.clientY - r.top - host.clientTop, true);
  };
  const leave = (): void => onMove(0, 0, false);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerleave', leave);
  return () => {
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', leave);
  };
}
