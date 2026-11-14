/** Every class is af- prefixed so nothing clashes with portfolio styles. */
export const STYLE_ID = 'af-styles';

export const CSS = `
.af-canvas{position:absolute;inset:0;z-index:0;pointer-events:none;display:block}
.af-ui{position:absolute;z-index:2;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#a1a1aa}
.af-debug{position:absolute;top:8px;left:8px;z-index:2;padding:6px 8px;border-radius:8px;
  background:rgba(20,20,24,.6);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.08);
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#a1a1aa;white-space:pre;
  pointer-events:none}
`;

let refCount = 0;

/** Injected once per document, removed when the last field is destroyed. */
export function injectStyles(doc: Document): void {
  refCount++;
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function releaseStyles(doc: Document): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  doc.getElementById(STYLE_ID)?.remove();
}
