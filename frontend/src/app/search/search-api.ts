/** Types of the backend's POST /api/search; names follow GLOSSARY.md. */

export type OfferKind = 'roundTrip' | 'oneWay';

export interface SearchQuery {
  kind: OfferKind;
  homeAirports: string[];
  destination: { airports: string[] };
  travelWindow: { from: string; to: string };
  /** Range of hotel nights, both ends inclusive; round trips only. */
  stayLength?: { min: number; max: number };
  /** Absent filters restrict nothing; inbound ones and returnWeekdays apply to round trips only. */
  filters?: SearchFilters;
  /** Price by default; price per night for round trips only. */
  sort?: SortOrder;
}

export type SortOrder = 'price' | 'pricePerNight';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SearchFilters {
  directOnly?: boolean;
  outboundDeparture?: TimeRange;
  outboundArrival?: TimeRange;
  inboundDeparture?: TimeRange;
  inboundArrival?: TimeRange;
  /** Days of the outbound departure, by local date. */
  departureWeekdays?: Weekday[];
  /** Days of the inbound departure, by local date. */
  returnWeekdays?: Weekday[];
}

/**
 * Times "HH:MM", both ends inclusive, in the local time of the airport concerned;
 * wraps past midnight when `to` is before `from`.
 */
export interface TimeRange {
  from: string;
  to: string;
}

export interface SearchResponse {
  offers: Offer[];
}

export interface Offer {
  kind: OfferKind;
  outbound: Leg;
  /** Round trips only; may land at a different home airport than the outbound leg departed from. */
  inbound?: Leg;
  /** Hotel nights of a round trip (GLOSSARY: Night). */
  nights?: number;
  /** Offer price in PLN for one adult, cheapest fare, no cabin bag. */
  price: Price;
  /** Offer price divided by the nights; round trips of at least one night only. */
  pricePerNight?: Price;
  /** When the oldest stored price of the offer's flights was fetched (ISO 8601). */
  priceFetchedAt: string;
}

/** An amount in PLN; approximate when converted from another currency. */
export interface Price {
  amount: number;
  currency: string;
  approximate: boolean;
}

export interface Leg {
  isDirect: boolean;
  flights: Flight[];
}

export interface Flight {
  departureAirport: string;
  arrivalAirport: string;
  departure: LocalTime;
  arrival: LocalTime;
  originalPrice: Money;
  fetchedAt: string;
}

/** Wall-clock date and time at an airport, in that airport's time zone. */
export interface LocalTime {
  date: string;
  time: string;
  timeZone: string;
}

export interface Money {
  amount: number;
  currency: string;
}
