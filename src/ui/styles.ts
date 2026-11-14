const CSS = `
.af-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block}
.af-debug{position:absolute;right:12px;top:10px;z-index:2;white-space:pre;pointer-events:none;
  font:11px ui-monospace,Menlo,Consolas,monospace;color:#71717a}
`;

let refs = 0;
let el: HTMLStyleElement | null = null;

/** Inject the af- styles once (ref-counted across instances); remove when the last instance goes. */
export function acquireStyles(): () => void {
  if (refs++ === 0) {
    el = document.createElement('style');
    el.setAttribute('data-af', '');
    el.textContent = CSS;
    document.head.append(el);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0) {
      el?.remove();
      el = null;
    }
  };
}
