import { Offer } from './search-api';
import { offerView } from './offer-view';

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

describe('offerView', () => {
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
    expect(view.price).toBe('≈ 84.98 PLN');
    expect(view.foreignPrices).toEqual(['19.99 EUR']);
    expect(view.priceAge).toBe('3 h ago');
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

  it('formats round-trip badges, per-night price and separate tickets', () => {
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
        pricePerNight: { amount: 84.98, currency: 'PLN', approximate: true },
      },
      Date.parse('2027-01-01T12:00:00Z'),
    );
    expect(view.legs[0].flights[0].day).toBe('Sat 5 Dec 2026');
    expect(view.legs[0].stops).toBe('1 stop');
    expect(view.legs[1].stops).toBeUndefined();
    expect(view.nights).toBe('1 night');
    expect(view.leaveDays).toBe('no leave days');
    expect(view.freeLeave).toBe(true);
    expect(view.pricePerNight).toBe('≈ 84.98 PLN per night');
    expect(view.priceAge).toBe('27 days ago');
    expect(view.ticketCount).toBe('three');
    expect(view.tickets).toHaveLength(3);
  });
});
