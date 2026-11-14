import { Texts, shortDay } from '../i18n/texts';
import { addDays, daysBetween } from './calendar-days';
import { placeNames } from './catalogue-names';
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

/** What the page says about a search that found no offers. */
export interface NoOffers {
  title: string;
  text: string;
  suggestions: Suggestion[];
}

const widenDays = 14;
const aroundDays = 3;

/**
 * Describes a search that found nothing: its route and dates, and the changes that apply to
 * that query. Nothing is checked ahead of time; each suggestion is only a change to try.
 * `today` is the browser's local date, which a flexible window never starts before.
 */
export function describeNoOffers(
  v: SearchFormValue,
  catalogue: Catalogue | undefined,
  language: string,
  texts: Texts,
  today: string,
): NoOffers {
  const fixed = v.dateMode === 'fixed';
  const roundTrip = v.kind === 'roundTrip';
  const day = (iso: string) => shortDay(texts, iso, true);
  const names = (value: string) =>
    placeNames(value, catalogue, language, texts.t('places.anywhere')).join(', ');
  const route = `${names(v.homeAirports)} → ${names(v.destination)}`;
  const dates = fixed && !roundTrip ? day(v.from) : `${day(v.from)} – ${day(v.to)}`;

  const suggestions: Suggestion[] = [];
  const add = (id: SuggestionId, patch: Partial<SearchFormValue>, params = {}) =>
    suggestions.push({ id, patch, label: texts.t(`results.noOffers.${id}`, params) });

  if (fixed) {
    const earliest = addDays(v.from, -aroundDays);
    const nights = daysBetween(v.from, v.to);
    add('flexibleDates', {
      dateMode: 'flexible',
      from: earliest < today ? today : earliest,
      to: addDays(roundTrip ? v.to : v.from, aroundDays),
      // The stay keeps its nights exactly; only the days around it widen.
      ...(roundTrip && { stayLength: { min: nights, max: nights } }),
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
    title: texts.t('results.noOffers.title', { route }),
    text: texts.t('results.noOffers.tryOne', { dates }),
    suggestions,
  };
}
