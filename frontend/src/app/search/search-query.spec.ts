import roundTripRequest from '../../../../contract/round-trip.request.json';
import oneWayRequest from '../../../../contract/one-way.request.json';
import foreignCurrencyRequest from '../../../../contract/foreign-currency.request.json';
import queryErrorRequest from '../../../../contract/query-error.request.json';
import { Catalogue, Offer, SearchQuery, Weekday } from './search-api';
import {
  buildSearchQuery,
  defaultWorkEnd,
  defaultWorkStart,
  departureDaysWithoutChoice,
  fieldApplies,
  SearchFormValue,
  sortOffers,
  windowWeekdays,
} from './search-query';

/** Departure days with only the given weekdays ticked. */
function only(...ticked: Weekday[]): Record<Weekday, boolean> {
  const all: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return Object.fromEntries(all.map((d) => [d, ticked.includes(d)])) as Record<Weekday, boolean>;
}

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
        mon: true,
        tue: true,
        wed: true,
        thu: true,
        fri: true,
        sat: true,
        sun: true,
      },
      inboundDepartureWeekdays: {
        mon: true,
        tue: true,
        wed: true,
        thu: true,
        fri: true,
        sat: true,
        sun: true,
      },
    },
  };
}

/** How the form's raw value and the catalogue become the search request. */
describe('buildSearchQuery', () => {
  it('builds the shared round-trip request with default work hours', () => {
    expect(buildSearchQuery(rawValue(), catalogue)).toEqual(roundTripRequest);
  });

  it('builds the shared one-way request without work hours', () => {
    const value = rawValue();
    value.kind = 'oneWay';
    expect(buildSearchQuery(value, catalogue)).toEqual(oneWayRequest);
  });

  it('builds the shared foreign-currency scenario request', () => {
    const value = rawValue();
    value.stayLength = { min: 0, max: 10 };
    expect(buildSearchQuery(value, catalogue)).toEqual(foreignCurrencyRequest);
  });

  it('serializes the invalid stay range in the shared error request', () => {
    const value = rawValue();
    value.stayLength = { min: 3, max: 2 };
    expect(buildSearchQuery(value, catalogue)).toEqual(queryErrorRequest);
  });

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
    v.sort = 'leaveDays';
    v.filters.inboundDeparture = { from: '14:00', to: '' }; // left over from a round-trip search
    v.filters.inboundDepartureWeekdays = only('sun');
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

  it('omits an ignored leave limit while keeping work hours and leave sorting', () => {
    const value = rawValue();
    value.leave = {
      ignoreLeave: true,
      workStart: '08:00',
      workEnd: '16:00',
      maxLeaveDays: 0,
    };
    value.sort = 'leaveDays';

    const query = buildSearchQuery(value, catalogue);
    expect(query).not.toHaveProperty('maxLeaveDays');
    expect(query).toMatchObject({ workStart: '08:00', workEnd: '16:00', sort: 'leaveDays' });
  });

  it('sends the chosen filters: direct only, time ranges of every moment and weekdays of both directions', () => {
    const v = rawValue();
    v.filters.directOnly = true;
    v.filters.outboundDeparture = { from: '06:00', to: '12:00' };
    v.filters.outboundArrival = { from: '09:00', to: '23:59' };
    v.filters.inboundArrival = { from: '00:00', to: '22:00' };
    v.filters.outboundDepartureWeekdays = only('thu', 'fri');
    v.filters.inboundDepartureWeekdays = only('sun');

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

/** Which departure days the travel window allows, and which ticked ones the search sends. */
describe('departure days', () => {
  it('finds the weekdays a travel window contains', () => {
    // Wed 11 Nov 2026 – Fri 13 Nov 2026
    expect([...windowWeekdays('2026-11-11', '2026-11-13')]).toEqual(['wed', 'thu', 'fri']);
    expect([...windowWeekdays('2026-11-14', '2026-11-16')]).toEqual(['sat', 'sun', 'mon']);
    expect(windowWeekdays('2026-11-11', '2026-11-17').size).toBe(7);
    // Incomplete or reversed windows grey out nothing; the form reports them on its own.
    expect(windowWeekdays('', '2026-11-13').size).toBe(7);
    expect(windowWeekdays('2026-11-13', '2026-11-11').size).toBe(7);
  });

  it('sends no weekday filter while every possible day is ticked, whatever days outside the window say', () => {
    const v = rawValue();
    v.from = '2026-11-11';
    v.to = '2026-11-13';
    v.filters.outboundDepartureWeekdays = only('wed', 'thu', 'fri');
    v.filters.inboundDepartureWeekdays.mon = false;

    expect(buildSearchQuery(v, catalogue).filters).toBeUndefined();
  });

  it('sends the possible days left ticked once one of them is unticked', () => {
    const v = rawValue();
    v.from = '2026-11-11';
    v.to = '2026-11-13';
    v.filters.outboundDepartureWeekdays.thu = false;
    v.filters.inboundDepartureWeekdays = only('fri', 'sun');

    expect(buildSearchQuery(v, catalogue).filters).toEqual({
      outboundDepartureWeekdays: ['wed', 'fri'],
      inboundDepartureWeekdays: ['fri'],
    });
  });

  it('reports departure days with no possible day ticked, inbound ones for round trips only', () => {
    const v = rawValue();
    v.from = '2026-11-11';
    v.to = '2026-11-13';
    v.filters.outboundDepartureWeekdays = only('sat', 'sun');
    v.filters.inboundDepartureWeekdays = only();
    expect(departureDaysWithoutChoice(v)).toEqual([
      'outboundDepartureWeekdays',
      'inboundDepartureWeekdays',
    ]);

    v.kind = 'oneWay';
    expect(departureDaysWithoutChoice(v)).toEqual(['outboundDepartureWeekdays']);

    v.filters.outboundDepartureWeekdays.thu = true;
    expect(departureDaysWithoutChoice(v)).toEqual([]);
  });
});

/** How found offers are reordered when the user switches the sort. */
describe('sortOffers', () => {
  const offer = (amount: number, leaveDays?: number) =>
    ({ price: { amount, currency: 'PLN', approximate: false }, leaveDays }) as Offer;
  const shown = (offers: Offer[]) => offers.map((o) => `${o.price.amount}/${o.leaveDays}`);

  it('orders by price, or by leave days and then by price, leaving the input alone', () => {
    const found = [offer(300, 0), offer(100, 2), offer(200, 0), offer(150, 2)];

    expect(shown(sortOffers(found, 'price'))).toEqual(['100/2', '150/2', '200/0', '300/0']);
    expect(shown(sortOffers(found, 'leaveDays'))).toEqual(['200/0', '300/0', '100/2', '150/2']);
    expect(shown(found)).toEqual(['300/0', '100/2', '200/0', '150/2']);
  });
});
