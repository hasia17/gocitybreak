import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Language } from '../i18n/language';
import { plural, Texts } from '../i18n/texts';
import { Catalogue } from './search-api';
import { AnywhereLabel, cataloguePlaces } from './place-suggestions';
import { placeValue, readPlaceSelections } from './place-selection';
import { SearchFormValue } from './search-query';

/** What the one-line summary of a search says, in the interface language. */
export interface SearchSummaryText {
  /** The home airports and the destination, like "Kraków → Anywhere". */
  route: string;
  /** The remaining facts, like "20 Dec – 13 Jan", "2–3 nights" or "One way". */
  details: { text: string; accent: boolean }[];
}

/** Home airports shown by name before the rest collapse into "+N". */
const shownAirports = 2;

/** A day like "20 Dec" or "20 gru", with the year when it is not `thisYear`. */
function summaryDay(texts: Texts, isoDate: string, thisYear: number): string {
  const year = Number(isoDate.slice(0, 4));
  return new Intl.DateTimeFormat(texts.locale, {
    day: 'numeric',
    month: 'short',
    ...(year !== thisYear && { year: 'numeric' }),
    timeZone: 'UTC',
  })
    .formatToParts(Date.parse(isoDate))
    .map((part) => part.value.replace(/\.$/, ''))
    .join('');
}

/** The names of the places in a form field, in the interface language; unknown ones keep their code. */
function placeNames(
  catalogue: Catalogue,
  field: 'homeAirports' | 'destination',
  value: string,
  language: Language,
  anywhere: AnywhereLabel | undefined,
): string[] {
  const known = cataloguePlaces(catalogue, field, language, anywhere);
  return readPlaceSelections(value).map(
    (place) => known.find((k) => k.value === placeValue(place))?.name ?? place.code,
  );
}

/**
 * The summary of a search: the places, dates and nights it asked for. Round trips on flexible
 * dates name the stay length, fixed ones name both dates, and one way ones say so.
 */
export function summarySearch(
  v: SearchFormValue,
  catalogue: Catalogue,
  texts: Texts,
  language: Language,
  anywhere: AnywhereLabel | undefined,
  now: number,
): SearchSummaryText {
  const homes = placeNames(catalogue, 'homeAirports', v.homeAirports, language, anywhere);
  const from =
    homes.slice(0, shownAirports).join(', ') +
    (homes.length > shownAirports ? ` +${homes.length - shownAirports}` : '');
  const to = placeNames(catalogue, 'destination', v.destination, language, anywhere).join(', ');
  const thisYear = new Date(now).getFullYear();
  const day = (iso: string) => summaryDay(texts, iso, thisYear);
  const roundTrip = v.kind === 'roundTrip';
  const flexible = (v.dateMode ?? 'flexible') === 'flexible';
  const details: SearchSummaryText['details'] = [];
  if (!roundTrip) details.push({ text: texts.t('search.kind.oneWay'), accent: false });
  const twoDates = flexible || roundTrip;
  details.push({ text: twoDates ? `${day(v.from)} – ${day(v.to)}` : day(v.from), accent: true });
  if (roundTrip && flexible) {
    const { min, max } = v.stayLength;
    details.push({
      text: plural(texts, 'search.summary.nights', Number(max), {
        range: Number(min) === Number(max) ? `${min}` : `${min}–${max}`,
      }),
      accent: false,
    });
  }
  return { route: `${from} → ${to}`, details };
}

/** The one line that replaces the search form after a search, with the button that brings it back. */
@Component({
  selector: 'app-search-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './search-summary.css',
  host: { 'data-testid': 'summary' },
  template: `
    <div class="wrap">
      <span class="route">{{ summary().route }}</span>
      @for (detail of summary().details; track $index) {
        <span [class.accent]="detail.accent">{{ detail.text }}</span>
      }
      <button type="button" (click)="change.emit()">{{ changeLabel() }}</button>
    </div>
  `,
})
export class SearchSummary {
  readonly summary = input.required<SearchSummaryText>();
  readonly changeLabel = input.required<string>();
  /** The user wants the form back. */
  readonly change = output<void>();
}
