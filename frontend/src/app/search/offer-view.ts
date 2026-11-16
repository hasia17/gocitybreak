import { Texts, ago, money, moneyParts, plural, shortDay } from '../i18n/texts';
import { Catalogue, Offer } from './search-api';
import { daysBetween } from './calendar-days';
import { byCode, catalogueName } from './catalogue-names';
import { tickets } from './tickets';

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
    const airport = byCode(catalogue?.airports, code);
    // The first city is Ryanair's own; later cities are nearby search groups (e.g. Milan for BGY).
    const city = byCode(catalogue?.cities, airport?.cities[0]);
    return city ? `${code} ${catalogueName(city, language)}` : code;
  };
  const legs = [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const offerTickets = tickets(offer);
  return {
    legs: legs.map((leg, index) => ({
      label: texts.t(index === 0 ? 'offer.outbound' : 'offer.return'),
      stops: leg.isDirect ? undefined : plural(texts, 'offer.stops', leg.flights.length - 1),
      flights: leg.flights.map((flight) => {
        const dateYear = Number(flight.departure.date.slice(0, 4));
        const airline = texts.t(`airline.${flight.airline}`);
        return {
          airline,
          departureDate: flight.departure.date,
          day: shortDay(texts, flight.departure.date, dateYear !== year),
          departureTime: flight.departure.time,
          /** An estimated arrival reads "~10:40" (GLOSSARY: Estimated arrival). */
          arrivalTime: (flight.estimatedArrival ? '~' : '') + flight.arrival.time,
          /** Why the arrival is estimated, for its ⓘ; undefined when the airline published it. */
          estimatedArrival: flight.estimatedArrival
            ? texts.t('tips.estimatedArrival.text', { airline })
            : undefined,
          arrivalDate: flight.arrival.date,
          daysLater: daysBetween(flight.departure.date, flight.arrival.date),
          from: airportName(flight.departureAirport),
          to: airportName(flight.arrivalAirport),
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
      offerTickets.length > 1
        ? plural(texts, 'results.separateTickets', offerTickets.length)
        : undefined,
    price: money(texts, offer.price, { whole: true }),
    /** The price in runs for its stamp: the amount large, the currency small. */
    priceParts: moneyParts(texts, offer.price, { whole: true }),
    approximatePrice: !!offer.price.approximate,
    foreignPrices: legs
      .flatMap((leg) => leg.flights)
      .map((flight) => flight.originalPrice)
      .filter((price) => price.currency !== 'PLN')
      .map((price) => money(texts, price)),
    /** What the one ⓘ says: the exchange rate (if converted), the stored-price age, ticket risk. */
    priceInfo: [
      offer.price.approximate ? texts.t('tips.approximatePrice.text') : undefined,
      texts.t('tips.priceAge.text'),
      offerTickets.length > 1 ? texts.t('tips.separateTickets.text') : undefined,
    ]
      .filter(Boolean)
      .join(' '),
    priceFetchedAt: offer.priceFetchedAt,
    priceAge: ago(texts, offer.priceFetchedAt, now),
    tickets: offerTickets.map((ticket) => ({
      ...ticket,
      airlineName: texts.t(`airline.${ticket.airline}`),
    })),
  };
}
