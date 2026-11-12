import { Texts, ago, money, plural, shortDay } from '../i18n/texts';
import { Catalogue, Offer } from './search-api';
import { catalogueName } from './catalogue-names';
import { ryanairTickets } from './ryanair-booking';

/** Display values for one result, including its booking links. */
export type OfferView = ReturnType<typeof offerView>;

/**
 * Converts a valid API offer and the current epoch milliseconds into result-list display values in
 * the language of `texts`. Dates use the traveller's current year; price age is clamped to zero
 * for future fetch times. Airports show their own city from the catalogue, or just the code when
 * that city is unavailable.
 */
export function offerView(offer: Offer, now: number, texts: Texts, catalogue?: Catalogue) {
  const year = new Date(now).getFullYear();
  const language = new Intl.Locale(texts.locale).language;
  const airportName = (code: string) => {
    const airport = catalogue?.airports.find((a) => a.code === code);
    // The first city is Ryanair's own; later cities are nearby search groups (e.g. Milan for BGY).
    const city = catalogue?.cities.find((c) => c.code === airport?.cities[0]);
    return city ? `${code} ${catalogueName(city, language)}` : code;
  };
  const legs = [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const tickets = ryanairTickets(offer);
  return {
    legs: legs.map((leg, index) => ({
      label: texts.t(index === 0 ? 'offer.outbound' : 'offer.return'),
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
          route: `${airportName(flight.departureAirport)} → ${airportName(flight.arrivalAirport)}`,
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
    approximatePrice: !!offer.price.approximate,
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
