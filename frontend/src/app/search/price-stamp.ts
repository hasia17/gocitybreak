import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MoneyPart } from '../i18n/texts';

/**
 * Direction D's price stamp: the amount large, its currency small. The tilt is `--stamp-tilt`,
 * so a list can tilt every other stamp the other way.
 */
@Component({
  selector: 'app-price-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stamp' },
  styleUrl: './price-stamp.css',
  template: `<strong>
    @for (part of parts(); track $index) {
      @if (part.mark) {
        <small>{{ part.text }}</small>
      } @else {
        <span>{{ part.text }}</span>
      }
    }
  </strong>`,
})
export class PriceStamp {
  readonly parts = input.required<MoneyPart[]>();
}
