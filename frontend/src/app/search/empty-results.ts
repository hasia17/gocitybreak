import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EmptyResult, SuggestionId } from './empty-suggestions';

/** A search that found nothing: what was searched, and changes to try instead. */
@Component({
  selector: 'app-empty-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './empty-results.css',
  host: { 'data-testid': 'empty' },
  template: `
    <h2>{{ empty().title }}</h2>
    <p>{{ empty().text }}</p>
    @if (empty().suggestions.length > 0) {
      <ul class="suggestions">
        @for (suggestion of empty().suggestions; track suggestion.id) {
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
export class EmptyResults {
  readonly empty = input.required<EmptyResult>();
  /** The suggestion the user pressed. */
  readonly chosen = output<SuggestionId>();
}
