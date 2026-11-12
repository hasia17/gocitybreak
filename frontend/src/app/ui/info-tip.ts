import { Component, input, signal } from '@angular/core';

let nextId = 0;

/**
 * An ⓘ button that shows a short explanation: on hover, keyboard focus and tap (hover alone does
 * not work on phones). Escape closes it. The text is always in the page, linked to the button
 * with `aria-describedby`, so screen readers announce it without opening it.
 */
@Component({
  selector: 'app-info-tip',
  template: `
    <button
      type="button"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="id"
      [attr.aria-expanded]="open()"
      (click)="open.set(true)"
      (focus)="open.set(true)"
      (blur)="open.set(false)"
      (mouseenter)="open.set(true)"
      (mouseleave)="open.set(false)"
      (keydown.escape)="open.set(false)"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="7" />
        <path d="M8 7.25v4M8 4.75v.01" />
      </svg>
    </button>
    <span role="tooltip" [id]="id" [class.open]="open()">{{ text() }}</span>
  `,
  styleUrl: './info-tip.css',
})
export class InfoTip {
  /** The explanation. */
  readonly text = input.required<string>();
  /** The button's accessible name, like "About departure days". */
  readonly label = input.required<string>();

  protected readonly open = signal(false);
  protected readonly id = `info-tip-${nextId++}`;
}
