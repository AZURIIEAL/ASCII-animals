const CSS = `
.af-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block}
.af-switcher{position:absolute;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:4px;
  max-width:calc(100% - 24px);box-sizing:border-box;padding:4px;overflow-x:auto;scrollbar-width:none;
  background:rgba(20,20,24,.6);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  border:1px solid rgba(255,255,255,.08);border-radius:999px;
  font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.af-switcher::-webkit-scrollbar{display:none}
.af-switcher.af-top{top:12px}
.af-switcher.af-bottom{bottom:12px}
.af-pill{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;
  height:26px;padding:0 10px;border-radius:999px;color:#a1a1aa;cursor:pointer;white-space:nowrap;
  transition:background-color .15s,color .15s}
.af-pill:hover{color:#e4e4e7;background:rgba(255,255,255,.04)}
.af-pill[aria-checked="true"]{color:#fafafa;background:rgba(255,255,255,.08)}
.af-pill:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}
.af-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.af-pill[aria-checked="false"] .af-dot{opacity:.7}
.af-compact .af-label{display:none}
.af-compact .af-pill{padding:0 8px}
@media (prefers-reduced-motion:reduce){.af-pill{transition:none}}
.af-debug{position:absolute;right:12px;top:56px;z-index:2;white-space:pre;pointer-events:none;
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
