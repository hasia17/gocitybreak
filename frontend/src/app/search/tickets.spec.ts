import { Airline, Flight, Offer } from './search-api';
import { LinkBuilder, LinkBuilders, tickets } from './tickets';

const flight = (airline: Airline, from: string, to: string, date: string): Flight => ({
  airline,
  departureAirport: from,
  arrivalAirport: to,
  departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
  arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
  originalPrice: { amount: 100, currency: 'PLN' },
  fetchedAt: '2026-12-01T08:00:00Z',
});

const roundTrip = (out: Flight, back: Flight): Offer => ({
  kind: 'roundTrip',
  outbound: { isDirect: true, flights: [out] },
  inbound: { isDirect: true, flights: [back] },
  price: { amount: 200, currency: 'PLN', approximate: false },
  priceFetchedAt: '2026-12-01T08:00:00Z',
});

// A second airline exists only in these tests; its link builder tells it apart from Ryanair's.
const other = 'other' as Airline;
const link =
  (airline: string): LinkBuilder =>
  (out, back) =>
    `${airline}:${out.departureAirport}${back ? '+' + back.departureAirport : ''}`;
const builders = { ryanair: link('ryanair'), other: link('other') } as unknown as LinkBuilders;

describe('tickets', () => {
  it('books a round trip of one airline between the same two airports as one ticket of that airline', () => {
    const offer = roundTrip(
      flight(other, 'KRK', 'BGY', '2026-12-04'),
      flight(other, 'BGY', 'KRK', '2026-12-06'),
    );
    expect(tickets(offer, builders)).toEqual([
      { airline: other, route: 'KRK ⇄ BGY', url: 'other:KRK+BGY' },
    ]);
  });

  it('books a round trip of two airlines as two one-way tickets, each from its own airline', () => {
    const offer = roundTrip(
      flight('ryanair', 'KRK', 'BGY', '2026-12-04'),
      flight(other, 'BGY', 'KRK', '2026-12-06'),
    );
    expect(tickets(offer, builders)).toEqual([
      { airline: 'ryanair', route: 'KRK → BGY', url: 'ryanair:KRK' },
      { airline: other, route: 'BGY → KRK', url: 'other:BGY' },
    ]);
  });
});
