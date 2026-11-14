import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NoOffers, SuggestionId } from './no-offers';

/** A search that found nothing: what was searched, and changes to try instead. */
@Component({
  selector: 'app-no-offers-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './no-offers-message.css',
  host: { 'data-testid': 'no-offers' },
  template: `
    <h2>{{ noOffers().title }}</h2>
    <p>{{ noOffers().text }}</p>
    @if (noOffers().suggestions.length > 0) {
      <ul class="suggestions">
        @for (suggestion of noOffers().suggestions; track suggestion.id) {
          <li>
            <button
              type="button"
              data-testid="suggestion"
              [attr.data-suggestion]="suggestion.id"
              (click)="chosen.emit(suggestion.id)"
            >
              {{ suggestion.label }}
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class NoOffersMessage {
  readonly noOffers = input.required<NoOffers>();
  /** The suggestion the user pressed. */
  readonly chosen = output<SuggestionId>();
}
