import { NonNullableFormBuilder } from '@angular/forms';
import { OfferKind, SearchFilters, Weekday } from './search-api';

/** The four moments of an offer that a time range can restrict, in travel order. */
export const moments = [
  { name: 'outboundDeparture', label: 'Outbound departure', inbound: false },
  { name: 'outboundArrival', label: 'Outbound arrival', inbound: false },
  { name: 'inboundDeparture', label: 'Inbound departure', inbound: true },
  { name: 'inboundArrival', label: 'Inbound arrival', inbound: true },
] as const;

export const weekdays: { value: Weekday; label: string }[] = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

/** Form controls of the filters; their initial values restrict nothing. */
export function filtersForm(fb: NonNullableFormBuilder) {
  const timeRange = () => fb.group({ from: '', to: '' });
  const days = () =>
    fb.group({
      mon: false,
      tue: false,
      wed: false,
      thu: false,
      fri: false,
      sat: false,
      sun: false,
    });
  return fb.group({
    directOnly: false,
    outboundDeparture: timeRange(),
    outboundArrival: timeRange(),
    inboundDeparture: timeRange(),
    inboundArrival: timeRange(),
    outboundDepartureWeekdays: days(),
    inboundDepartureWeekdays: days(),
  });
}

type FiltersValue = ReturnType<ReturnType<typeof filtersForm>['getRawValue']>;

/**
 * The query's filters for offers of kind, or undefined when nothing is restricted.
 * A time range with one end left empty runs from the start or to the end of the day.
 */
export function toSearchFilters(v: FiltersValue, kind: OfferKind): SearchFilters | undefined {
  const filters: SearchFilters = {};
  if (v.directOnly) filters.directOnly = true;
  for (const m of moments) {
    const { from, to } = v[m.name];
    if ((from || to) && (!m.inbound || kind === 'roundTrip')) {
      filters[m.name] = { from: from || '00:00', to: to || '23:59' };
    }
  }
  const chosen = (days: Record<Weekday, boolean>) =>
    weekdays.map((d) => d.value).filter((d) => days[d]);
  const outbound = chosen(v.outboundDepartureWeekdays);
  if (outbound.length) filters.outboundDepartureWeekdays = outbound;
  const inbound = chosen(v.inboundDepartureWeekdays);
  if (inbound.length && kind === 'roundTrip') filters.inboundDepartureWeekdays = inbound;
  return Object.keys(filters).length ? filters : undefined;
}
