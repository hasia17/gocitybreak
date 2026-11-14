import { Catalogue } from './search-api';
import { readPlaceSelections } from './place-selection';

/** The catalogue name in the interface language, falling back to the original name. */
export function catalogueName(
  place: { name: string; names?: Record<string, string> },
  language: string,
): string {
  return place.names?.[language] ?? place.name;
}

/** The entry of a catalogue list with this code; undefined when there is none. */
export function byCode<T extends { code: string }>(
  list: readonly T[] | undefined,
  code: string | undefined,
): T | undefined {
  return list?.find((item) => item.code === code);
}

/**
 * The names, in the interface language, of the places in a form field's value, like
 * ["Kraków", "Anywhere"]; a place missing from the catalogue keeps its code.
 */
export function placeNames(
  value: string,
  catalogue: Catalogue | undefined,
  language: string,
  anywhere: string,
): string[] {
  return readPlaceSelections(value).map((place) => {
    if (place.kind === 'anywhere') return anywhere;
    const list =
      place.kind === 'airport'
        ? [...(catalogue?.airports ?? []), ...(catalogue?.supportedAirports ?? [])]
        : place.kind === 'city'
          ? catalogue?.cities
          : catalogue?.countries;
    const found = byCode(list, place.code);
    return found ? catalogueName(found, language) : place.code;
  });
}
