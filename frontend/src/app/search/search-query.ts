/**
 * The rules of the search query, as one plain module without Angular: which form fields apply
 * to which kind of offer, and how the form's raw value and the catalogue become the search
 * request. The search component enables, disables and shows fields from the applicability
 * table and builds its request with {@link buildSearchQuery}.
 */
import { Catalogue, OfferKind, SearchFilters, SearchQuery, SortOrder, Weekday } from './search-api';
import { readTypedNames } from './typed-names';

/** The four moments of an offer that a time range can restrict, in travel order. */
export const moments = [
  { name: 'outboundDeparture' },
  { name: 'outboundArrival' },
  { name: 'inboundDeparture' },
  { name: 'inboundArrival' },
] as const;

/** The weekdays a departure can be restricted to, from Monday to Sunday. */
export const weekdays: { value: Weekday }[] = [
  { value: 'mon' },
  { value: 'tue' },
  { value: 'wed' },
  { value: 'thu' },
  { value: 'fri' },
  { value: 'sat' },
  { value: 'sun' },
];

const byDay: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The weekdays the travel window contains, both ends included: every weekday for a window of
 * 7 days or more, and also while the window is incomplete or ends before it starts (the form
 * reports that on its own).
 */
export function windowWeekdays(from: string, to: string): Set<Weekday> {
  const all = new Set(weekdays.map((d) => d.value));
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return all;
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days >= 7) return all;
  return new Set(
    Array.from({ length: days }, (_, i) => byDay[new Date(start + i * 86_400_000).getUTCDay()]),
  );
}

/** The two sets of departure days of the filters. */
export type DepartureDays = 'outboundDepartureWeekdays' | 'inboundDepartureWeekdays';

/**
 * The ticked weekdays among the possible ones: a ticked day suits the traveller, and a day
 * outside the travel window is ignored whether ticked or not.
 */
function chosenDays(days: Record<Weekday, boolean>, possible: Set<Weekday>): Weekday[] {
  return weekdays.map((d) => d.value).filter((d) => possible.has(d) && days[d]);
}

/**
 * The departure days that apply to the kind of offer and have none of their possible weekdays
 * ticked: a search would find nothing, so the form asks to leave at least one ticked.
 */
export function departureDaysWithoutChoice(v: SearchFormValue): DepartureDays[] {
  if (v.dateMode === 'fixed') return [];
  const possible = windowWeekdays(v.from, v.to);
  return (['outboundDepartureWeekdays', 'inboundDepartureWeekdays'] as const).filter(
    (name) =>
      fieldApplies(`filters.${name}`, v.kind) && chosenDays(v.filters[name], possible).length === 0,
  );
}

/**
 * The form fields that apply to round trips only, by their control path like "leave" or
 * "filters.inboundDeparture"; every other field applies to both kinds of offer. The component
 * disables these fields for a one-way search (a disabled control keeps its value, so remembered
 * settings lose nothing), the template hides them and {@link buildSearchQuery} leaves them out
 * of the request.
 */
export const roundTripOnlyFields: readonly string[] = [
  'stayLength',
  'leave',
  'sort',
  'filters.inboundDeparture',
  'filters.inboundArrival',
  'filters.inboundDepartureWeekdays',
];

/** Flexible travel window and nights, or exact local departure dates. */
export type DateMode = 'flexible' | 'fixed';

/** Whether a form field applies to the chosen kind of offer and date mode. */
export function fieldApplies(
  path: string,
  kind: OfferKind,
  dateMode: DateMode = 'flexible',
): boolean {
  if (dateMode === 'fixed') {
    if (
      [
        'stayLength',
        'filters.outboundDepartureWeekdays',
        'filters.inboundDepartureWeekdays',
      ].includes(path)
    )
      return false;
    if (path === 'to' && kind === 'oneWay') return false;
  }
  return kind === 'roundTrip' || !roundTripOnlyFields.includes(path);
}

/** Office hours the form starts from; the backend assumes the same when a query sets none. */
export const defaultWorkStart = '09:00';
export const defaultWorkEnd = '17:00';

/** The distinct airport codes typed as "krk, KTW", upper-cased. */
export function typedCodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((code) => code.toUpperCase()),
    ),
  ];
}

/** The filters part of the search form's raw value. */
export interface FiltersValue {
  directOnly: boolean;
  outboundDeparture: { from: string; to: string };
  outboundArrival: { from: string; to: string };
  inboundDeparture: { from: string; to: string };
  inboundArrival: { from: string; to: string };
  outboundDepartureWeekdays: Record<Weekday, boolean>;
  inboundDepartureWeekdays: Record<Weekday, boolean>;
}

/** The search form's raw value: what getRawValue() returns, keeping the values of disabled fields. */
export interface SearchFormValue {
  kind: OfferKind;
  dateMode?: DateMode;
  homeAirports: string;
  destination: string;
  exclusions: string;
  from: string;
  to: string;
  stayLength: { min: number; max: number };
  leave: { workStart: string; workEnd: string; maxLeaveDays: number | null };
  sort: SortOrder;
  filters: FiltersValue;
}

/**
 * Builds the search request: typed home airports, destination and exclusions resolved against
 * the catalogue (airport codes are known without it), and every field that does not apply to
 * the kind of offer left out. Fields that restrict nothing (leave maximum, filters, departure
 * days with every possible day ticked) are left out as well.
 */
export function buildSearchQuery(
  v: SearchFormValue,
  catalogue: Catalogue | undefined,
): SearchQuery {
  const query: SearchQuery = {
    kind: v.kind,
    homeAirports: typedCodes(v.homeAirports),
    destination: {},
  };
  if (v.dateMode === 'fixed') {
    query.fixedDates = { outbound: v.from, ...(v.kind === 'roundTrip' && { inbound: v.to }) };
  } else {
    query.travelWindow = { from: v.from, to: v.to };
  }
  const destination = readTypedNames(v.destination, catalogue);
  query.destination = destination.anywhere ? { anywhere: true } : destination.codes;
  const exclusions = readTypedNames(v.exclusions, catalogue).codes;
  if (Object.keys(exclusions).length > 0) query.exclusions = exclusions;
  if (fieldApplies('stayLength', v.kind, v.dateMode))
    query.stayLength = { min: Number(v.stayLength.min), max: Number(v.stayLength.max) };
  if (fieldApplies('leave', v.kind)) {
    query.workStart = v.leave.workStart;
    query.workEnd = v.leave.workEnd;
    if (v.leave.maxLeaveDays != null) query.maxLeaveDays = Number(v.leave.maxLeaveDays);
  }
  if (fieldApplies('sort', v.kind)) query.sort = v.sort;
  const filters: SearchFilters = {};
  if (v.filters.directOnly) filters.directOnly = true;
  for (const m of moments) {
    const { from, to } = v.filters[m.name];
    if (from && to && fieldApplies(`filters.${m.name}`, v.kind)) filters[m.name] = { from, to };
  }
  // Departure days restrict the search only when some possible day is unticked.
  const possible = windowWeekdays(v.from, v.to);
  for (const name of ['outboundDepartureWeekdays', 'inboundDepartureWeekdays'] as const) {
    const chosen = chosenDays(v.filters[name], possible);
    if (
      fieldApplies(`filters.${name}`, v.kind, v.dateMode) &&
      chosen.length > 0 &&
      chosen.length < possible.size
    )
      filters[name] = chosen;
  }
  if (Object.keys(filters).length > 0) query.filters = filters;
  return query;
}
