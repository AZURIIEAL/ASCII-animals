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
