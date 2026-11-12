import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import en from '../../../public/i18n/en.json';
import pl from '../../../public/i18n/pl.json';
import { Language, textsIn } from '../i18n/language';
import { provideTestI18n } from '../i18n/testing';
import { Offer } from './search-api';
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
      route: 'BGY → KRK',
    });
    expect(plain(view.price)).toBe('≈ PLN 84.98');
    expect(view.foreignPrices).toEqual(['€19.99']);
    expect(view.priceAge).toBe('3 hr ago');
    expect(view.tickets[0].url).toContain('originIata=BGY');
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
    expect(plain(two.price)).toBe('≈ 84,98 zł');
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
