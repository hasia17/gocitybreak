import { Texts, shortDay } from '../i18n/texts';
import { catalogueName } from './catalogue-names';
import { readPlaceSelections } from './place-selection';
import { Catalogue } from './search-api';
import { SearchFormValue } from './search-query';

/** The changes offered for a search that found nothing. */
export type SuggestionId =
  'widenWindow' | 'moreNights' | 'removeExclusions' | 'anywhere' | 'flexibleDates';

/** A suggestion's button text and the change it makes to the search form. */
export interface Suggestion {
  id: SuggestionId;
  label: string;
  patch: Partial<SearchFormValue>;
}

/** What the page says about a search that found nothing. */
export interface EmptyResult {
  title: string;
  text: string;
  suggestions: Suggestion[];
}

const widenDays = 14;
const aroundDays = 3;

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function placeNames(
  value: string,
  catalogue: Catalogue | undefined,
  language: string,
  texts: Texts,
): string {
  return readPlaceSelections(value)
    .map((place) => {
      if (place.kind === 'anywhere') return texts.t('places.anywhere');
      const list =
        place.kind === 'airport'
          ? catalogue?.airports
          : place.kind === 'city'
            ? catalogue?.cities
            : catalogue?.countries;
      const found = list?.find((item) => item.code === place.code);
      return found ? catalogueName(found, language) : place.code;
    })
    .join(', ');
}

/**
 * Describes a search that found nothing: its route and dates, and the changes that apply to
 * that query. Nothing is checked ahead of time; each suggestion is only a change to try.
 * `today` is the browser's local date, which a flexible window never starts before.
 */
export function emptyResult(
  v: SearchFormValue,
  catalogue: Catalogue | undefined,
  language: string,
  texts: Texts,
  today: string,
): EmptyResult {
  const fixed = v.dateMode === 'fixed';
  const roundTrip = v.kind === 'roundTrip';
  const day = (iso: string) => shortDay(texts, iso, true);
  const route = `${placeNames(v.homeAirports, catalogue, language, texts)} → ${placeNames(v.destination, catalogue, language, texts)}`;
  const dates = fixed && !roundTrip ? day(v.from) : `${day(v.from)} – ${day(v.to)}`;

  const suggestions: Suggestion[] = [];
  const add = (id: SuggestionId, patch: Partial<SearchFormValue>, params = {}) =>
    suggestions.push({ id, patch, label: texts.t(`results.empty.${id}`, params) });

  if (fixed) {
    const earliest = addDays(v.from, -aroundDays);
    const nights = daysBetween(v.from, v.to);
    add('flexibleDates', {
      dateMode: 'flexible',
      from: earliest < today ? today : earliest,
      to: addDays(roundTrip ? v.to : v.from, aroundDays),
      ...(roundTrip && { stayLength: { min: Math.max(1, nights - 1), max: nights + 1 } }),
    });
  } else {
    const to = addDays(v.to, widenDays);
    add('widenWindow', { to }, { date: day(to) });
    if (roundTrip) {
      const stay = {
        min: Math.max(1, Number(v.stayLength.min) - 1),
        max: Number(v.stayLength.max) + 1,
      };
      add('moreNights', { stayLength: stay }, stay);
    }
  }
  if (v.exclusions.trim()) add('removeExclusions', { exclusions: '' });
  if (!readPlaceSelections(v.destination).some((place) => place.kind === 'anywhere'))
    add('anywhere', { destination: 'anywhere' });

  return {
    title: texts.t('results.empty.title', { route }),
    text: texts.t(suggestions.length > 0 ? 'results.empty.tryOne' : 'results.empty.tryMore', {
      dates,
    }),
    suggestions,
  };
}
