/**
 * Destination groups (GLOSSARY: Destination group): the found offers grouped by the airport the
 * outbound leg lands at, for a destination that covers more than one airport.
 */
import { Texts } from '../i18n/texts';
import { catalogueName } from './catalogue-names';
import { Catalogue, CatalogueCodes, Offer } from './search-api';
import { offerView, OfferView } from './offer-view';
import { readTypedNames } from './typed-names';

/** One destination group as shown: its airport and its offers in the sort order. */
export interface DestinationGroup {
  /** The destination airport's code, like "BGY". */
  airport: string;
  /** The airport in the interface language, like "Mediolan-Bergamo"; the code when unknown. */
  name: string;
  /** The airport's country in the interface language; empty when unknown. */
  country: string;
  /** Offers to the airport in the sort order; the first is the group's best offer. */
  offers: OfferView[];
}

/**
 * Whether the typed destination less the typed exclusions covers more than one airport:
 * Anywhere, a country, a city of several airports or several places.
 */
export function coversSeveralAirports(
  destination: string,
  exclusions: string,
  catalogue: Catalogue | undefined,
): boolean {
  const typed = readTypedNames(destination, catalogue);
  if (typed.anywhere) return true;
  const excluded = airportsOf(readTypedNames(exclusions, catalogue).codes, catalogue);
  return [...airportsOf(typed.codes, catalogue)].filter((a) => !excluded.has(a)).length > 1;
}

function airportsOf(codes: CatalogueCodes, catalogue: Catalogue | undefined): Set<string> {
  return new Set([
    ...(codes.airports ?? []),
    ...(catalogue?.cities ?? [])
      .filter((c) => codes.cities?.includes(c.code))
      .flatMap((c) => c.airports),
    ...(catalogue?.airports ?? [])
      .filter((a) => a.country && codes.countries?.includes(a.country))
      .map((a) => a.code),
  ]);
}

/**
 * Sorted offers grouped by destination airport, in the display values of `texts`. Each group
 * keeps the offers' order, and groups follow their first offer, so groups are ordered by their
 * best offer under the same sort.
 */
export function destinationGroups(
  sorted: readonly Offer[],
  now: number,
  texts: Texts,
  catalogue: Catalogue | undefined,
): DestinationGroup[] {
  const language = new Intl.Locale(texts.locale).language;
  const groups = new Map<string, DestinationGroup>();
  for (const offer of sorted) {
    const code = offer.outbound.flights.at(-1)!.arrivalAirport;
    let group = groups.get(code);
    if (!group) {
      const airport = catalogue?.airports.find((a) => a.code === code);
      const country = catalogue?.countries.find((c) => c.code === airport?.country);
      group = {
        airport: code,
        name: airport ? catalogueName(airport, language).trim() : code,
        country: country ? catalogueName(country, language) : '',
        offers: [],
      };
      groups.set(code, group);
    }
    group.offers.push(offerView(offer, now, texts, catalogue));
  }
  return [...groups.values()];
}
