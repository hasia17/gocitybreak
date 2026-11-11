import { Flight, Offer } from './search-api';

/** A link to buy one Ryanair ticket: a round trip, or a single one-way flight. */
export interface RyanairTicket {
  /** The flights it books, e.g. "KRK ⇄ BGY" or "KRK → BGY". */
  route: string;
  url: string;
}

const selectFlights = 'https://www.ryanair.com/gb/en/trip/flights/select';

/**
 * The Ryanair tickets that buy the offer's flights. A round trip that returns to the airport it
 * left from is one round-trip ticket; anything else (a return to a different home airport, a
 * self-transfer) is bought as separate one-way tickets, one per flight: Ryanair's booking link has
 * a single origin and destination, reversed for the return.
 */
export function ryanairTickets(offer: Offer): RyanairTicket[] {
  const out = offer.outbound.flights;
  const back = offer.inbound?.flights;
  if (
    back &&
    out.length === 1 &&
    back.length === 1 &&
    out[0].departureAirport === back[0].arrivalAirport &&
    out[0].arrivalAirport === back[0].departureAirport
  ) {
    return [
      {
        route: `${out[0].departureAirport} ⇄ ${out[0].arrivalAirport}`,
        url: link(out[0], back[0]),
      },
    ];
  }
  return [...out, ...(back ?? [])].map((f) => ({
    route: `${f.departureAirport} → ${f.arrivalAirport}`,
    url: link(f),
  }));
}

/** Ryanair's flight selection for one adult: one way, or a round trip when `inbound` is given. */
function link(outbound: Flight, inbound?: Flight): string {
  const params = new URLSearchParams({
    adults: '1',
    teens: '0',
    children: '0',
    infants: '0',
    dateOut: outbound.departure.date,
    dateIn: inbound?.departure.date ?? '',
    isConnectedFlight: 'false',
    isReturn: String(inbound !== undefined),
    discount: '0',
    originIata: outbound.departureAirport,
    destinationIata: outbound.arrivalAirport,
  });
  return `${selectFlights}?${params}`;
}
