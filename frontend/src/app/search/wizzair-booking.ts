import { Flight } from './search-api';

const selectFlight = 'https://www.wizzair.com/en-gb/booking/select-flight';

/**
 * Wizz Air's flight selection for one adult: one way, or a round trip when `inbound` is given.
 * The path is `<from>/<to>/<out date>/<return date or null>/<adults>/<children>/<infants>/null`.
 */
export function wizzairLink(outbound: Flight, inbound?: Flight): string {
  return [
    selectFlight,
    outbound.departureAirport,
    outbound.arrivalAirport,
    outbound.departure.date,
    inbound?.departure.date ?? 'null',
    '1',
    '0',
    '0',
    'null',
  ].join('/');
}
