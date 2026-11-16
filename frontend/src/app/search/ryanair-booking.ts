import { Flight } from './search-api';

const selectFlights = 'https://www.ryanair.com/gb/en/trip/flights/select';

/** Ryanair's flight selection for one adult: one way, or a round trip when `inbound` is given. */
export function ryanairLink(outbound: Flight, inbound?: Flight): string {
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
