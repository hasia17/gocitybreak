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

/** Whether the form field named by its control path applies to offers of the kind. */
export function fieldApplies(path: string, kind: OfferKind): boolean {
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
 * the kind of offer left out. Fields that restrict nothing (leave maximum, filters) are left
 * out as well.
 */
export function buildSearchQuery(
  v: SearchFormValue,
  catalogue: Catalogue | undefined,
): SearchQuery {
  const query: SearchQuery = {
    kind: v.kind,
    homeAirports: typedCodes(v.homeAirports),
    destination: {},
    travelWindow: { from: v.from, to: v.to },
  };
  const destination = readTypedNames(v.destination, catalogue);
  query.destination = destination.anywhere ? { anywhere: true } : destination.codes;
  const exclusions = readTypedNames(v.exclusions, catalogue).codes;
  if (Object.keys(exclusions).length > 0) query.exclusions = exclusions;
  if (fieldApplies('stayLength', v.kind))
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
  const chosen = (days: Record<Weekday, boolean>) =>
    weekdays.map((d) => d.value).filter((d) => days[d]);
  const outbound = chosen(v.filters.outboundDepartureWeekdays);
  if (outbound.length) filters.outboundDepartureWeekdays = outbound;
  const inbound = chosen(v.filters.inboundDepartureWeekdays);
  if (inbound.length && fieldApplies('filters.inboundDepartureWeekdays', v.kind))
    filters.inboundDepartureWeekdays = inbound;
  if (Object.keys(filters).length > 0) query.filters = filters;
  return query;
}
