import type { AnimalId } from '../types';
import type { AnimalMeta } from '../animals/registry';

/**
 * Animal switcher (§11): a row of glass pills, each with a coloured dot. A real radiogroup: one tab
 * stop (roving tabindex), arrow keys / Home / End move the selection. Scrolls sideways when the row
 * is wider than the host; under 480 px only the dots show.
 */
export class Switcher {
  readonly el = document.createElement('div');
  private pills: HTMLButtonElement[] = [];
  private current: AnimalId;

  constructor(
    host: HTMLElement,
    private animals: AnimalMeta[],
    current: AnimalId,
    position: 'top' | 'bottom',
    private onSelect: (id: AnimalId) => void,
  ) {
    this.current = current;
    this.el.className = `af-ui af-switcher af-${position}`;
    this.el.setAttribute('role', 'radiogroup');
    this.el.setAttribute('aria-label', 'Animal');
    for (const a of animals) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'af-pill';
      b.setAttribute('role', 'radio');
      b.dataset.id = a.id;
      b.title = a.label;
      const dot = document.createElement('span');
      dot.className = 'af-dot';
      dot.style.background = a.dot;
      dot.style.boxShadow = `0 0 6px ${a.dot}66`;
      const label = document.createElement('span');
      label.className = 'af-label';
      label.textContent = a.label;
      b.append(dot, label);
      b.addEventListener('click', () => this.choose(a.id, false));
      this.pills.push(b);
      this.el.append(b);
    }
    this.el.addEventListener('keydown', this.onKey);
    host.append(this.el);
    this.sync(false);
  }

  private onKey = (ev: KeyboardEvent): void => {
    const i = this.animals.findIndex((a) => a.id === this.current);
    let j = i;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % this.animals.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + this.animals.length) % this.animals.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = this.animals.length - 1;
    else return;
    ev.preventDefault(); // only for keys we handle, and only inside the switcher
    this.choose(this.animals[j].id, true);
  };

  private choose(id: AnimalId, focus: boolean): void {
    if (id !== this.current) {
      this.current = id;
      this.onSelect(id);
    }
    this.sync(focus);
  }

  /** Reflect an animal chosen from outside (setAnimal). */
  set(id: AnimalId): void {
    this.current = id;
    this.sync(false);
  }

  /** Dots only when the host is narrow. */
  layout(hostWidth: number): void {
    this.el.classList.toggle('af-compact', hostWidth < 480);
  }

  private sync(focus: boolean): void {
    for (const b of this.pills) {
      const on = b.dataset.id === this.current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        if (focus) b.focus({ preventScroll: true });
        // Keep the active pill in view without scrolling the page.
        const el = this.el;
        const left = b.offsetLeft - el.clientWidth / 2 + b.offsetWidth / 2;
        el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }
    }
  }

  destroy(): void {
    this.el.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
