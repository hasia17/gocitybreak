/** Types of the backend's POST /api/search and GET /api/catalogue; names follow GLOSSARY.md. */

export type OfferKind = 'roundTrip' | 'oneWay';

/** Airports, cities and countries, each named by its code from the catalogue. */
export interface Places {
  airports?: string[];
  cities?: string[];
  countries?: string[];
}

/** Where to fly: any number of places, or anywhere (all airports reachable from the home airports). */
export interface Destination extends Places {
  anywhere?: boolean;
}

export interface SearchQuery {
  kind: OfferKind;
  homeAirports: string[];
  destination: Destination;
  /** Places removed from the destination. */
  exclusions?: Places;
  travelWindow: { from: string; to: string };
  /** Range of hotel nights, both ends inclusive; round trips only. */
  stayLength?: { min: number; max: number };
  /** Work start and work end as HH:MM in the home airport's local time; round trips only. */
  workStart?: string;
  workEnd?: string;
  /** Leaves out round-trip offers that cost more leave days; 0 is a valid maximum. */
  maxLeaveDays?: number;
  /** Absent filters restrict nothing; inbound ones and returnWeekdays apply to round trips only. */
  filters?: SearchFilters;
  /** Price by default; price per night for round trips only. */
  sort?: SortOrder;
}

export type SortOrder = 'price' | 'leaveDays' | 'pricePerNight';

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
  /** Working days a round trip costs (GLOSSARY: Leave days). */
  leaveDays?: number;
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

/** What the search form chooses from. */
export interface Catalogue {
  supportedAirports: { code: string; name: string }[];
  airports: CatalogueAirport[];
  /** A city covers several airports, e.g. Milan covers MXP and BGY. */
  cities: City[];
  countries: Country[];
}

export interface CatalogueAirport {
  code: string;
  name: string;
  /** Codes of the cities the airport belongs to; an airport may belong to several. */
  cities: string[];
  country?: string;
}

export interface City {
  code: string;
  name: string;
  country?: string;
  airports: string[];
}

export interface Country {
  /** Lower-case ISO 3166-1 alpha-2 code, e.g. "it". */
  code: string;
  name: string;
}
