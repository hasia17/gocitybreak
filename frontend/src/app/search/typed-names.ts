import { Catalogue, CatalogueCodes } from './search-api';
import { placeTokens, readPlaceValue } from './place-selection';

/** Airports, cities and countries typed as text, separated by commas: what they name and what they fail to name. */
export interface TypedNames {
  /** "anywhere" was typed. */
  anywhere: boolean;
  codes: CatalogueCodes;
  /** Typed names that match no airport, city or country. */
  unknown: string[];
}

/**
 * Reads airports, cities and countries typed as "Milan, Spain, OSL" or canonical "anywhere". Each name is, in this order,
 * an airport code, a city, a country or an airport name, all case-insensitive. Without the catalogue only
 * airport codes are known.
 */
export function readTypedNames(text: string, catalogue: Catalogue | undefined): TypedNames {
  const typed: TypedNames = { anywhere: false, codes: {}, unknown: [] };
  const add = (kind: keyof CatalogueCodes, code: string) => {
    const codes = (typed.codes[kind] ??= []);
    if (!codes.includes(code)) codes.push(code);
  };
  const named = <T extends { name: string; names?: Record<string, string> }>(
    items: T[] | undefined,
    name: string,
  ) =>
    items?.find((item) =>
      [item.name, ...Object.values(item.names ?? {})].some((value) => value.toLowerCase() === name),
    );

  for (const raw of placeTokens(text)) {
    const name = raw.toLowerCase();
    const selection = readPlaceValue(raw);
    if (selection?.kind === 'anywhere') {
      typed.anywhere = true;
      continue;
    }
    if (selection?.kind === 'city' && catalogue?.cities.some((c) => c.code === selection.code)) {
      add('cities', selection.code);
      continue;
    }
    if (
      selection?.kind === 'country' &&
      catalogue?.countries.some((c) => c.code === selection.code)
    ) {
      add('countries', selection.code);
      continue;
    }
    if (
      selection?.kind === 'airport' &&
      (!catalogue || catalogue.airports.some((a) => a.code === selection.code))
    ) {
      add('airports', selection.code);
      continue;
    }
    const city = named(catalogue?.cities, name);
    const country = named(catalogue?.countries, name);
    const airport = named(catalogue?.airports, name);
    if (city) add('cities', city.code);
    else if (country) add('countries', country.code);
    else if (airport) add('airports', airport.code);
    else typed.unknown.push(raw.trim());
  }
  return typed;
}
