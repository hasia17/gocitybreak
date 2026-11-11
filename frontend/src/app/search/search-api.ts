/** Types of the backend's POST /api/search; names follow GLOSSARY.md. */

export interface SearchQuery {
  kind: 'oneWay';
  homeAirports: string[];
  destination: { airports: string[] };
  travelWindow: { from: string; to: string };
}

export interface SearchResponse {
  offers: Offer[];
}

export interface Offer {
  kind: 'oneWay';
  outbound: Leg;
  /** Offer price in PLN for one adult, cheapest fare, no cabin bag. */
  price: { amount: number; currency: string; approximate: boolean };
  /** When the oldest stored price of the offer's flights was fetched (ISO 8601). */
  priceFetchedAt: string;
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
