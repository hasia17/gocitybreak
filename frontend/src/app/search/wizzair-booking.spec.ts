import { Flight } from './search-api';
import { wizzairLink } from './wizzair-booking';

const flight = (from: string, to: string, date: string): Flight => ({
  airline: 'wizzair',
  departureAirport: from,
  arrivalAirport: to,
  departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
  arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
  originalPrice: { amount: 100, currency: 'PLN' },
  fetchedAt: '2026-12-01T00:00:00Z',
});

describe('wizzairLink', () => {
  it('opens the flight selection for one adult, one way', () => {
    expect(wizzairLink(flight('KRK', 'BGY', '2026-12-04'))).toBe(
      'https://www.wizzair.com/en-gb/booking/select-flight/KRK/BGY/2026-12-04/null/1/0/0/null',
    );
  });

  it('opens the flight selection for one adult, round trip', () => {
    expect(
      wizzairLink(flight('KRK', 'BGY', '2026-12-04'), flight('BGY', 'KRK', '2026-12-06')),
    ).toBe(
      'https://www.wizzair.com/en-gb/booking/select-flight/KRK/BGY/2026-12-04/2026-12-06/1/0/0/null',
    );
  });
});
