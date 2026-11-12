import { Texts, ago, money, plural, shortDay } from '../i18n/texts';
import { Offer } from './search-api';
import { ryanairTickets } from './ryanair-booking';

/** Display values for one result, including its booking links. */
export type OfferView = ReturnType<typeof offerView>;

/**
 * Converts a valid API offer and the current epoch milliseconds into result-list display values in
 * the language of `texts`. Dates use the traveller's current year; price age is clamped to zero
 * for future fetch times.
 */
export function offerView(offer: Offer, now: number, texts: Texts) {
  const year = new Date(now).getFullYear();
  const legs = [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const tickets = ryanairTickets(offer);
  return {
    legs: legs.map((leg) => ({
      stops: leg.isDirect ? undefined : plural(texts, 'offer.stops', leg.flights.length - 1),
      flights: leg.flights.map((flight) => {
        const dateYear = Number(flight.departure.date.slice(0, 4));
        return {
          departureDate: flight.departure.date,
          day: shortDay(texts, flight.departure.date, dateYear !== year),
          departureTime: flight.departure.time,
          arrivalTime: flight.arrival.time,
          arrivalDate: flight.arrival.date,
          daysLater: Math.round(
            (Date.parse(flight.arrival.date) - Date.parse(flight.departure.date)) / 86_400_000,
          ),
          route: `${flight.departureAirport} → ${flight.arrivalAirport}`,
        };
      }),
    })),
    nights: offer.nights === undefined ? undefined : plural(texts, 'offer.nights', offer.nights),
    leaveDays:
      offer.leaveDays === undefined
        ? undefined
        : offer.leaveDays === 0
          ? texts.t('offer.noLeaveDays')
          : plural(texts, 'offer.leaveDays', offer.leaveDays),
    freeLeave: offer.leaveDays === 0,
    separateTickets:
      tickets.length > 1 ? plural(texts, 'results.separateTickets', tickets.length) : undefined,
    price: money(texts, offer.price),
    foreignPrices: legs
      .flatMap((leg) => leg.flights)
      .map((flight) => flight.originalPrice)
      .filter((price) => price.currency !== 'PLN')
      .map((price) => money(texts, price)),
    priceFetchedAt: offer.priceFetchedAt,
    priceAge: ago(texts, offer.priceFetchedAt, now),
    tickets,
  };
}
