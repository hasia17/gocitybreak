import { Catalogue, SearchQuery } from './search-api';
import {
  buildSearchQuery,
  defaultWorkEnd,
  defaultWorkStart,
  fieldApplies,
  SearchFormValue,
} from './search-query';

/** Airports, cities and countries to resolve typed names against. */
const catalogue: Catalogue = {
  supportedAirports: [{ code: 'KRK', name: 'Kraków' }],
  airports: [
    { code: 'BGY', name: 'Milan Bergamo', cities: ['BERGAMO', 'MILAN'], country: 'it' },
    { code: 'KRK', name: 'Kraków', cities: ['KRAKOW'], country: 'pl' },
    { code: 'MXP', name: 'Milan Malpensa', cities: ['MILAN'], country: 'it' },
    { code: 'OSL', name: 'Oslo', cities: ['OSLO'], country: 'no' },
  ],
  cities: [
    { code: 'BERGAMO', name: 'Bergamo', country: 'it', airports: ['BGY'] },
    { code: 'KRAKOW', name: 'Kraków', country: 'pl', airports: ['KRK'] },
    { code: 'MILAN', name: 'Milan', country: 'it', airports: ['BGY', 'MXP'] },
    { code: 'OSLO', name: 'Oslo', country: 'no', airports: ['OSL'] },
  ],
  countries: [
    { code: 'it', name: 'Italy' },
    { code: 'no', name: 'Norway' },
    { code: 'pl', name: 'Poland' },
    { code: 'es', name: 'Spain' },
  ],
};

/** A raw form value with every field set to something valid; cases edit the parts they cover. */
function rawValue(): SearchFormValue {
  return {
    kind: 'roundTrip',
    homeAirports: 'KRK',
    destination: 'BGY',
    exclusions: '',
    from: '2026-12-01',
    to: '2026-12-10',
    stayLength: { min: 2, max: 3 },
    leave: { workStart: defaultWorkStart, workEnd: defaultWorkEnd, maxLeaveDays: null },
    sort: 'price',
    filters: {
      directOnly: false,
      outboundDeparture: { from: '', to: '' },
      outboundArrival: { from: '', to: '' },
      inboundDeparture: { from: '', to: '' },
      inboundArrival: { from: '', to: '' },
      outboundDepartureWeekdays: {
        mon: false,
        tue: false,
        wed: false,
        thu: false,
        fri: false,
        sat: false,
        sun: false,
      },
      inboundDepartureWeekdays: {
        mon: false,
        tue: false,
        wed: false,
        thu: false,
        fri: false,
        sat: false,
        sun: false,
      },
    },
  };
}

/** How the form's raw value and the catalogue become the search request. */
describe('buildSearchQuery', () => {
  it('builds a round-trip query, with the default work hours and price sort, that restricts nothing else', () => {
    const v = rawValue();
    v.homeAirports = 'krk, KTW krk';
    v.stayLength = { min: 2, max: 4 };

    expect(buildSearchQuery(v, catalogue)).toEqual<SearchQuery>({
      kind: 'roundTrip',
      homeAirports: ['KRK', 'KTW'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      stayLength: { min: 2, max: 4 },
      workStart: '09:00',
      workEnd: '17:00',
      sort: 'price',
    });
  });

  it('builds a one-way query without the round-trip-only fields, whatever their raw values say', () => {
    const v = rawValue();
    v.kind = 'oneWay';
    v.leave = { workStart: '08:00', workEnd: '16:00', maxLeaveDays: 2 };
    v.sort = 'pricePerNight';
    v.filters.inboundDeparture = { from: '14:00', to: '' }; // left over from a round-trip search
    v.filters.inboundDepartureWeekdays.sun = true;
    v.filters.outboundArrival = { from: '06:00', to: '10:00' };

    expect(buildSearchQuery(v, catalogue)).toEqual<SearchQuery>({
      kind: 'oneWay',
      homeAirports: ['KRK'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      filters: { outboundArrival: { from: '06:00', to: '10:00' } },
    });
  });

  it('sends the chosen work hours, a maximum of leave days (0 included) and the sort', () => {
    const v = rawValue();
    v.leave = { workStart: '08:00', workEnd: '16:00', maxLeaveDays: 0 };
    v.sort = 'leaveDays';

    expect(buildSearchQuery(v, catalogue)).toEqual<SearchQuery>({
      kind: 'roundTrip',
      homeAirports: ['KRK'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      stayLength: { min: 2, max: 3 },
      workStart: '08:00',
      workEnd: '16:00',
      maxLeaveDays: 0,
      sort: 'leaveDays',
    });
  });

  it('sends the chosen filters: direct only, time ranges of every moment and weekdays of both directions', () => {
    const v = rawValue();
    v.filters.directOnly = true;
    v.filters.outboundDeparture = { from: '06:00', to: '12:00' };
    v.filters.outboundArrival = { from: '09:00', to: '23:59' };
    v.filters.inboundArrival = { from: '00:00', to: '22:00' };
    v.filters.outboundDepartureWeekdays.thu = true;
    v.filters.outboundDepartureWeekdays.fri = true;
    v.filters.inboundDepartureWeekdays.sun = true;

    expect(buildSearchQuery(v, catalogue).filters).toEqual({
      directOnly: true,
      outboundDeparture: { from: '06:00', to: '12:00' },
      outboundArrival: { from: '09:00', to: '23:59' },
      inboundArrival: { from: '00:00', to: '22:00' },
      outboundDepartureWeekdays: ['thu', 'fri'],
      inboundDepartureWeekdays: ['sun'],
    });
  });

  it('resolves typed airports, cities and countries to codes, minus the exclusions', () => {
    const v = rawValue();
    v.destination = 'milan, Spain, osl';
    v.exclusions = 'Bergamo';

    const query = buildSearchQuery(v, catalogue);
    expect(query.destination).toEqual({ airports: ['OSL'], cities: ['MILAN'], countries: ['es'] });
    expect(query.exclusions).toEqual({ cities: ['BERGAMO'] });
  });

  it('takes anywhere, minus typed countries and airports', () => {
    const v = rawValue();
    v.destination = 'Anywhere';
    v.exclusions = 'Norway, italy, Milan Malpensa';

    const query = buildSearchQuery(v, catalogue);
    expect(query.destination).toEqual({ anywhere: true });
    expect(query.exclusions).toEqual({ airports: ['MXP'], countries: ['no', 'it'] });
  });

  it('takes airport codes before the catalogue is loaded', () => {
    expect(buildSearchQuery(rawValue(), undefined)).toEqual<SearchQuery>({
      kind: 'roundTrip',
      homeAirports: ['KRK'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      stayLength: { min: 2, max: 3 },
      workStart: '09:00',
      workEnd: '17:00',
      sort: 'price',
    });
  });
});

/** The applicability table: which form fields a round trip has that a one-way search does not. */
describe('field applicability', () => {
  it('applies stay length, work hours, the leave maximum, the sort and the inbound filters to round trips only', () => {
    const roundTripOnly = [
      'stayLength',
      'leave',
      'sort',
      'filters.inboundDeparture',
      'filters.inboundArrival',
      'filters.inboundDepartureWeekdays',
    ];
    for (const field of roundTripOnly) {
      expect(fieldApplies(field, 'roundTrip')).toBe(true);
      expect(fieldApplies(field, 'oneWay')).toBe(false);
    }
  });

  it('applies home airports, destination, exclusions, the travel window and the outbound filters to both kinds', () => {
    const both = [
      'kind',
      'homeAirports',
      'destination',
      'exclusions',
      'from',
      'to',
      'filters.directOnly',
      'filters.outboundDeparture',
      'filters.outboundArrival',
      'filters.outboundDepartureWeekdays',
    ];
    for (const kind of ['roundTrip', 'oneWay'] as const) {
      for (const field of both) expect(fieldApplies(field, kind)).toBe(true);
    }
  });
});
