import { ryanairLink } from './ryanair-booking';
import { Airline, Flight, Offer } from './search-api';
import { wizzairLink } from './wizzair-booking';

/** A link to buy one ticket (GLOSSARY: Ticket): a round trip, or a single one-way flight. */
export interface Ticket {
  airline: Airline;
  /** The flights it books, e.g. "KRK ⇄ BGY" or "KRK → BGY". */
  route: string;
  url: string;
}

/** Builds an airline's booking link for one adult: one way, or a round trip when `inbound` is given. */
export type LinkBuilder = (outbound: Flight, inbound?: Flight) => string;

/** One link builder per airline. */
export type LinkBuilders = Record<Airline, LinkBuilder>;

const linkBuilders: LinkBuilders = { ryanair: ryanairLink, wizzair: wizzairLink };

/**
 * The tickets that buy the offer's flights. A round trip is one round-trip ticket only when both
 * legs are direct flights of the same airline between the same two airports (a return to a
 * different home airport is not); anything else, a self-transfer or flights of two airlines, is
 * bought as separate one-way tickets, one per flight. Each link comes from its airline's builder.
 */
export function tickets(offer: Offer, builders: LinkBuilders = linkBuilders): Ticket[] {
  const out = offer.outbound.flights;
  const back = offer.inbound?.flights;
  if (
    back &&
    out.length === 1 &&
    back.length === 1 &&
    out[0].airline === back[0].airline &&
    out[0].departureAirport === back[0].arrivalAirport &&
    out[0].arrivalAirport === back[0].departureAirport
  ) {
    return [
      {
        airline: out[0].airline,
        route: `${out[0].departureAirport} ⇄ ${out[0].arrivalAirport}`,
        url: builders[out[0].airline](out[0], back[0]),
      },
    ];
  }
  return [...out, ...(back ?? [])].map((f) => ({
    airline: f.airline,
    route: `${f.departureAirport} → ${f.arrivalAirport}`,
    url: builders[f.airline](f),
  }));
}
