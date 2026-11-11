// PROTOTYPE (throwaway): floating bar that flips between look-and-feel variants via ?variant=.
import { Component, model } from '@angular/core';

const variants = ['A', 'B', 'C', 'now'] as const;
const names: Record<string, string> = {
  A: 'Composer',
  B: 'Sidebar',
  C: 'Conversation',
  now: 'current page',
};

@Component({
  selector: 'app-prototype-switcher',
  template: `
    <div class="bar" role="toolbar" aria-label="Prototype variants">
      <button type="button" (click)="step(-1)" aria-label="Previous variant">‹</button>
      <span>PROTOTYPE · {{ current() }} ({{ name() }})</span>
      <button type="button" (click)="step(1)" aria-label="Next variant">›</button>
    </div>
  `,
  styles: `
    .bar {
      position: fixed;
      z-index: 1000;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem;
      border-radius: 9999px;
      background: #ffe14d;
      color: #000;
      font: 600 0.75rem/1 ui-monospace, monospace;
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
      white-space: nowrap;
    }
    button {
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      border-radius: 50%;
      background: #000;
      color: #ffe14d;
      font-size: 1rem;
      cursor: pointer;
    }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class PrototypeSwitcher {
  readonly current = model.required<string>();

  protected name() {
    return names[this.current()] ?? '?';
  }

  protected step(delta: number) {
    const i = variants.indexOf(this.current() as (typeof variants)[number]);
    const next = variants[(i + delta + variants.length) % variants.length];
    this.current.set(next);
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(null, '', url);
  }

  protected onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') this.step(-1);
    if (e.key === 'ArrowRight') this.step(1);
  }
}
