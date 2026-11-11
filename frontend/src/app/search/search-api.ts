/** Types of the backend's POST /api/search; names follow GLOSSARY.md. */

export type OfferKind = 'roundTrip' | 'oneWay';

export interface SearchQuery {
  kind: OfferKind;
  homeAirports: string[];
  destination: { airports: string[] };
  travelWindow: { from: string; to: string };
  /** Range of hotel nights, both ends inclusive; round trips only. */
  stayLength?: { min: number; max: number };
  /** Work start and work end as HH:MM in the home airport's local time; round trips only. */
  workStart?: string;
  workEnd?: string;
  /** Leaves out round-trip offers that cost more leave days; 0 is a valid maximum. */
  maxLeaveDays?: number;
  sort?: SortOrder;
}

export type SortOrder = 'price' | 'leaveDays';

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
  price: { amount: number; currency: string; approximate: boolean };
  /** When the oldest stored price of the offer's flights was fetched (ISO 8601). */
  priceFetchedAt: string;
  /** Working days a round trip costs (GLOSSARY: Leave days). */
  leaveDays?: number;
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
