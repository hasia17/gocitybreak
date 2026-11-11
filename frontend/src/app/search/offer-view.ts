import { Offer } from './search-api';
import { ryanairTickets } from './ryanair-booking';

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** Display values for one result, including its booking links. */
export type OfferView = ReturnType<typeof offerView>;

/**
 * Converts a valid API offer and the current epoch milliseconds into result-list display values.
 * Dates use the traveller's current year; price age is clamped to zero for future fetch times.
 */
export function offerView(offer: Offer, now: number) {
  const year = new Date(now).getFullYear();
  const legs = [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const tickets = ryanairTickets(offer);
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return {
    legs: legs.map((leg) => ({
      stops: leg.isDirect
        ? undefined
        : `${leg.flights.length - 1} ${leg.flights.length === 2 ? 'stop' : 'stops'}`,
      flights: leg.flights.map((flight) => {
        const dateYear = Number(flight.departure.date.slice(0, 4));
        const day = dayFormat.format(Date.parse(flight.departure.date));
        return {
          departureDate: flight.departure.date,
          day: dateYear === year ? day : `${day} ${dateYear}`,
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
    nights:
      offer.nights === undefined
        ? undefined
        : `${offer.nights} ${offer.nights === 1 ? 'night' : 'nights'}`,
    leaveDays:
      offer.leaveDays === undefined
        ? undefined
        : offer.leaveDays === 0
          ? 'no leave days'
          : `${offer.leaveDays} ${offer.leaveDays === 1 ? 'leave day' : 'leave days'}`,
    freeLeave: offer.leaveDays === 0,
    pricePerNight: offer.pricePerNight
      ? `${offer.pricePerNight.approximate ? '≈ ' : ''}${offer.pricePerNight.amount.toFixed(2)} ${offer.pricePerNight.currency} per night`
      : undefined,
    ticketCount: words[tickets.length] ?? `${tickets.length}`,
    price: `${offer.price.approximate ? '≈ ' : ''}${offer.price.amount.toFixed(2)} ${offer.price.currency}`,
    foreignPrices: legs
      .flatMap((leg) => leg.flights)
      .map((flight) => flight.originalPrice)
      .filter((price) => price.currency !== 'PLN')
      .map((price) => `${price.amount.toFixed(2)} ${price.currency}`),
    priceFetchedAt: offer.priceFetchedAt,
    priceAge: priceAge(offer.priceFetchedAt, now),
    tickets,
  };
}

/** Formats the age of a stored price at the given time. */
export function priceAge(fetchedAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 60_000));
  const hours = Math.round(minutes / 60);
  return minutes < 60
    ? `${minutes} min ago`
    : hours < 48
      ? `${hours} h ago`
      : `${Math.round(hours / 24)} days ago`;
}
