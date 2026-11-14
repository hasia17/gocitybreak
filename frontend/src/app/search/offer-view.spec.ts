import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import en from '../../../public/i18n/en.json';
import pl from '../../../public/i18n/pl.json';
import { Language, textsIn } from '../i18n/language';
import { provideTestI18n } from '../i18n/testing';
import { Catalogue, Offer } from './search-api';
import { offerView as viewIn } from './offer-view';

const now = Date.parse('2026-12-05T12:00:00Z');
const offer: Offer = {
  kind: 'oneWay',
  outbound: {
    isDirect: true,
    flights: [
      {
        departureAirport: 'BGY',
        arrivalAirport: 'KRK',
        departure: { date: '2026-12-05', time: '23:30', timeZone: 'Europe/Rome' },
        arrival: { date: '2026-12-06', time: '01:20', timeZone: 'Europe/Warsaw' },
        originalPrice: { amount: 19.99, currency: 'EUR' },
        fetchedAt: '2026-12-05T09:00:00Z',
      },
    ],
  },
  price: { amount: 84.98, currency: 'PLN', approximate: true },
  priceFetchedAt: '2026-12-05T09:00:00Z',
};

/** Intl separates amounts from currencies with a no-break space; tests write a plain one. */
const plain = (text: string | undefined) => text?.replace(/ /g, ' ');

describe('offerView', () => {
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTestI18n()] });
    transloco = TestBed.inject(TranslocoService);
    transloco.setTranslation(en, 'en');
    transloco.setTranslation(pl, 'pl');
  });

  const offerView = (o: Offer, at: number, language: Language = 'en') =>
    viewIn(o, at, textsIn(transloco, language));

  it('formats a one-way offer with an overnight flight and foreign price', () => {
    const view = offerView(offer, now);
    expect(view.legs[0].flights[0]).toEqual({
      departureDate: '2026-12-05',
      day: 'Sat 5 Dec',
      departureTime: '23:30',
      arrivalTime: '01:20',
      arrivalDate: '2026-12-06',
      daysLater: 1,
      from: 'BGY',
      to: 'KRK',
    });
    expect(plain(view.price)).toBe('≈ PLN 85');
    expect(view.foreignPrices).toEqual(['€19.99']);
    expect(view.priceAge).toBe('3 hr ago');
    expect(view.tickets[0].url).toContain('originIata=BGY');
  });

  it('rounds the price to whole zloty, half up, keeping the approximate mark', () => {
    const priced = (amount: number, approximate: boolean, language: Language = 'en') =>
      plain(
        offerView({ ...offer, price: { amount, currency: 'PLN', approximate } }, now, language)
          .price,
      );
    expect(priced(156.5, true)).toBe('≈ PLN 157');
    expect(priced(156.49, true)).toBe('≈ PLN 156');
    expect(priced(89.99, false)).toBe('PLN 90');
    expect(priced(0.5, false)).toBe('PLN 1');
    expect(priced(1234.5, false, 'pl')).toBe('1235 zł');
    expect(priced(156.5, true, 'pl')).toBe('≈ 157 zł');
  });

  it('gives each flight its day and times separately, in both languages', () => {
    const flight = offerView(offer, now).legs[0].flights[0];
    expect([flight.day, flight.departureTime, flight.arrivalTime]).toEqual([
      'Sat 5 Dec',
      '23:30',
      '01:20',
    ]);
    const polish = offerView(offer, now, 'pl').legs[0].flights[0];
    expect([polish.day, polish.departureTime, polish.arrivalTime]).toEqual([
      'sob 5 gru',
      '23:30',
      '01:20',
    ]);
  });

  it('keeps foreign original prices out of the whole-zloty price', () => {
    const view = offerView(offer, now);
    expect(view.foreignPrices).toEqual(['€19.99']);
    expect(offerView(offer, now, 'pl').foreignPrices.map(plain)).toEqual(['19,99 €']);
    const home: Offer = {
      ...offer,
      price: { amount: 19.99, currency: 'PLN', approximate: false },
      outbound: {
        isDirect: true,
        flights: [
          { ...offer.outbound.flights[0], originalPrice: { amount: 19.99, currency: 'PLN' } },
        ],
      },
    };
    expect(offerView(home, now).foreignPrices).toEqual([]);
  });

  it('explains the exchange rate only when approximate, always the stored-price age', () => {
    const approximate = offerView(offer, now).priceInfo;
    expect(approximate).toMatch(/NBP mid-market rate.*stored price.*may have changed/);
    const exact = offerView(
      { ...offer, price: { amount: 85, currency: 'PLN', approximate: false } },
      now,
    ).priceInfo;
    expect(exact).not.toContain('NBP');
    expect(exact).toContain('stored price');
    expect(offerView(offer, now, 'pl').priceInfo).toContain('NBP');
  });

  it('labels the outbound and return legs in the interface language', () => {
    const roundTrip: Offer = {
      ...offer,
      kind: 'roundTrip',
      inbound: offer.outbound,
    };
    expect(offerView(roundTrip, now).legs.map((leg) => leg.label)).toEqual(['Outbound', 'Return']);
    expect(offerView(roundTrip, now, 'pl').legs.map((leg) => leg.label)).toEqual([
      'Wylot',
      'Powrót',
    ]);
    expect(offerView(offer, now).legs.map((leg) => leg.label)).toEqual(['Outbound']);
  });

  it('names every flight airport by its own city, in the interface language', () => {
    const catalogue: Catalogue = {
      supportedAirports: [],
      airports: [
        { code: 'BGY', name: 'Milan Bergamo', cities: ['BERGAMO', 'MILAN'] },
        { code: 'KRK', name: 'Krakow Airport', cities: ['KRAKOW'] },
      ],
      cities: [
        { code: 'MILAN', name: 'Milan', names: { pl: 'Mediolan' }, airports: ['BGY'] },
        { code: 'BERGAMO', name: 'Bergamo', airports: ['BGY'] },
        { code: 'KRAKOW', name: 'Krakow', names: { pl: 'Kraków' }, airports: ['KRK'] },
      ],
      countries: [],
    };
    const selfTransfer: Offer = {
      ...offer,
      kind: 'roundTrip',
      outbound: {
        isDirect: false,
        flights: [
          { ...offer.outbound.flights[0], departureAirport: 'KRK', arrivalAirport: 'STN' },
          { ...offer.outbound.flights[0], departureAirport: 'STN', arrivalAirport: 'BGY' },
        ],
      },
      inbound: offer.outbound,
    };
    const routes = (language: Language) =>
      viewIn(selfTransfer, now, textsIn(transloco, language), catalogue).legs.map((leg) =>
        leg.flights.map((flight) => `${flight.from} → ${flight.to}`),
      );
    expect(routes('en')).toEqual([
      ['KRK Krakow → STN', 'STN → BGY Bergamo'],
      ['BGY Bergamo → KRK Krakow'],
    ]);
    expect(routes('pl')).toEqual([
      ['KRK Kraków → STN', 'STN → BGY Bergamo'],
      ['BGY Bergamo → KRK Kraków'],
    ]);
  });

  it('handles leave-day plurals, zero nights and price-age boundaries', () => {
    const view = (leaveDays: number, fetched: string) =>
      offerView(
        {
          ...offer,
          leaveDays,
          nights: 0,
          priceFetchedAt: fetched,
        },
        now,
      );
    expect(view(1, '2026-12-05T11:59:00Z').leaveDays).toBe('1 leave day');
    expect(view(2, '2026-12-05T12:05:00Z').leaveDays).toBe('2 leave days');
    expect(view(2, '2026-12-05T12:05:00Z').priceAge).toBe('0 min ago');
    expect(view(2, '2026-12-05T11:59:00Z').priceAge).toBe('1 min ago');
    expect(view(2, '2026-12-05T11:59:00Z').nights).toBe('0 nights');
  });

  it('formats round-trip badges and separate tickets', () => {
    const view = offerView(
      {
        ...offer,
        kind: 'roundTrip',
        outbound: {
          isDirect: false,
          flights: [offer.outbound.flights[0], offer.outbound.flights[0]],
        },
        inbound: { isDirect: true, flights: [offer.outbound.flights[0]] },
        nights: 1,
        leaveDays: 0,
      },
      Date.parse('2027-01-01T12:00:00Z'),
    );
    expect(view.legs[0].flights[0].day).toBe('Sat 5 Dec 2026');
    expect(view.legs[0].stops).toBe('1 stop');
    expect(view.legs[1].stops).toBeUndefined();
    expect(view.nights).toBe('1 night');
    expect(view.leaveDays).toBe('no leave days');
    expect(view.freeLeave).toBe(true);
    expect(view.priceAge).toBe('27 days ago');
    expect(view.separateTickets).toBe('Booked as 3 separate one-way tickets');
    expect(view.priceInfo).toMatch(/self-transfer.*own risk/);
    expect(view.tickets).toHaveLength(3);
  });

  it('formats days, prices, ages and plurals in Polish', () => {
    const view = (nights: number, leaveDays: number, stops = 1) =>
      offerView(
        {
          ...offer,
          kind: 'roundTrip',
          outbound: {
            isDirect: stops === 0,
            flights: Array(stops + 1).fill(offer.outbound.flights[0]),
          },
          inbound: { isDirect: true, flights: [offer.outbound.flights[0]] },
          nights,
          leaveDays,
          priceFetchedAt: '2026-12-03T12:00:00Z',
        },
        now,
        'pl',
      );
    const two = view(2, 2);
    expect(two.legs[0].flights[0].day).toBe('sob 5 gru');
    expect(plain(two.price)).toBe('≈ 85 zł');
    expect(two.foreignPrices.map(plain)).toEqual(['19,99 €', '19,99 €', '19,99 €']);
    expect(two.priceAge).toBe('2 dni temu');
    expect(two.nights).toBe('2 noce');
    expect(two.leaveDays).toBe('2 dni urlopu');
    expect(two.legs[0].stops).toBe('1 przesiadka');
    expect(two.separateTickets).toBe('Kupowane jako 3 osobne bilety w jedną stronę');
    expect(view(1, 1).nights).toBe('1 noc');
    expect(view(1, 1).leaveDays).toBe('1 dzień urlopu');
    expect(view(5, 0, 4).nights).toBe('5 nocy');
    expect(view(5, 0, 4).leaveDays).toBe('bez urlopu');
    expect(view(5, 0, 4).legs[0].stops).toBe('4 przesiadki');
    expect(view(5, 0, 5).legs[0].stops).toBe('5 przesiadek');
    expect(view(5, 0, 5).separateTickets).toBe('Kupowane jako 7 osobnych biletów w jedną stronę');
  });
});
