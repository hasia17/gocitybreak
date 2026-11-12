import { Component, ElementRef, input, signal, viewChild } from '@angular/core';

let nextId = 0;

/**
 * An ⓘ button that shows a short explanation: on hover, keyboard focus and tap (hover alone does
 * not work on phones). Escape closes it. The text is always in the page, linked to the button
 * with `aria-describedby`, so screen readers announce it without opening it.
 */
@Component({
  selector: 'app-info-tip',
  host: {
    '(window:resize)': 'open.set(false)',
    '(window:scroll)': 'open.set(false)',
  },
  template: `
    <button
      type="button"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="id"
      [attr.aria-expanded]="open()"
      (click)="show($event)"
      (focus)="focused = true; show($event)"
      (blur)="focused = false; open.set(false)"
      (mouseenter)="show($event)"
      (mouseleave)="leave($event)"
      (keydown.escape)="open.set(false)"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="7" />
        <path d="M8 7.25v4M8 4.75v.01" />
      </svg>
    </button>
    <span
      #tip
      role="tooltip"
      [id]="id"
      [class.open]="open()"
      [style.left.px]="left()"
      [style.top.px]="top()"
      (mouseenter)="open.set(true)"
      (mouseleave)="leave($event)"
      >{{ text() }}</span
    >
  `,
  styleUrl: './info-tip.css',
})
export class InfoTip {
  /** The explanation. */
  readonly text = input.required<string>();
  /** The button's accessible name, like "About departure days". */
  readonly label = input.required<string>();

  protected readonly open = signal(false);
  protected readonly left = signal(8);
  protected readonly top = signal(8);
  protected focused = false;
  private readonly tip = viewChild.required<ElementRef<HTMLElement>>('tip');

  /** Clamp the overlay to the viewport, including triggers at a card's right edge. */
  protected show(event: Event) {
    const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const box = this.tip().nativeElement.getBoundingClientRect();
    const margin = 8;
    this.left.set(Math.max(margin, Math.min(anchor.left, window.innerWidth - box.width - margin)));
    const below = anchor.bottom;
    const preferred =
      below + box.height <= window.innerHeight - margin ? below : anchor.top - box.height;
    this.top.set(Math.max(margin, Math.min(preferred, window.innerHeight - box.height - margin)));
    this.open.set(true);
  }

  protected leave(event: MouseEvent) {
    const next = event.relatedTarget;
    if (this.focused || (next instanceof Node && this.tip().nativeElement.contains(next))) return;
    this.open.set(false);
  }
  protected readonly id = `info-tip-${nextId++}`;
}
