import { catalogueName } from './catalogue-names';
import { Catalogue } from './search-api';
import {
  PlaceSelection,
  placeTokens,
  placeValue,
  readPlaceValue,
  writePlaceSelections,
} from './place-selection';

/** Interface choice supplied by runtime translations, including names in every supported language. */
export interface AnywhereLabel {
  name: string;
  names: readonly string[];
}

export type PlaceField = 'homeAirports' | 'destination' | 'exclusions';
export interface PlaceSuggestion extends PlaceSelection {
  /** Stable form/storage identity; display names never become query identifiers. */
  value: string;
  name: string;
  context: string;
  airports: string[];
  names: readonly string[];
}

/** Fold Unicode accents and Polish ł, which does not decompose in Unicode normalization. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/gi, 'l').toLowerCase();
}

/** Every known choice for a field, with localized labels and language-independent identities. */
export function cataloguePlaces(
  catalogue: Catalogue,
  field: PlaceField,
  language: string,
  anywhere?: AnywhereLabel,
): PlaceSuggestion[] {
  const countryName = (code?: string) => {
    const country = catalogue.countries.find((c) => c.code === code);
    return country ? catalogueName(country, language) : '';
  };
  const names = (place: { name: string; names?: Record<string, string> }) => [
    place.name,
    ...Object.values(place.names ?? {}),
  ];
  const airports = catalogue.airports
    .filter(
      (a) => field !== 'homeAirports' || catalogue.supportedAirports.some((s) => s.code === a.code),
    )
    .map((a) => ({
      value: placeValue({ kind: 'airport', code: a.code }),
      kind: 'airport' as const,
      code: a.code,
      name: catalogueName(a, language),
      context: [catalogue.cities.find((c) => a.cities.includes(c.code))]
        .filter((c) => !!c)
        .map((c) => catalogueName(c, language))
        .concat(countryName(a.country))
        .filter(Boolean)
        .join(', '),
      airports: [a.code],
      names: names(a),
    }));
  if (field === 'homeAirports') {
    // A supported airport is usable even if omitted from an older catalogue's full airport list.
    for (const a of catalogue.supportedAirports)
      if (!airports.some((p) => p.code === a.code))
        airports.push({
          value: placeValue({ kind: 'airport', code: a.code }),
          kind: 'airport',
          code: a.code,
          name: catalogueName(a, language),
          context: '',
          airports: [a.code],
          names: names(a),
        });
    const poland = catalogue.countries.find((c) => c.code === 'pl') ?? {
      code: 'pl',
      name: 'Poland',
      names: { pl: 'Polska' },
    };
    return [
      ...airports,
      {
        value: placeValue({ kind: 'country', code: 'pl' }),
        kind: 'country',
        code: 'pl',
        name: catalogueName(poland, language),
        context: '',
        airports: catalogue.supportedAirports.map((a) => a.code),
        names: names(poland),
      },
    ];
  }
  return [
    ...airports,
    ...catalogue.cities.map((c) => ({
      value: placeValue({ kind: 'city', code: c.code }),
      kind: 'city' as const,
      code: c.code,
      name: catalogueName(c, language),
      context: countryName(c.country),
      airports: c.airports,
      names: names(c),
    })),
    ...catalogue.countries.map((c) => ({
      value: placeValue({ kind: 'country', code: c.code }),
      kind: 'country' as const,
      code: c.code,
      name: catalogueName(c, language),
      context: '',
      airports: catalogue.airports.filter((a) => a.country === c.code).map((a) => a.code),
      names: names(c),
    })),
    ...(field === 'destination'
      ? [
          {
            value: placeValue({ kind: 'anywhere', code: '' }),
            kind: 'anywhere' as const,
            code: '',
            name: anywhere?.name ?? '',
            context: '',
            airports: [],
            names: anywhere?.names ?? [],
          },
        ]
      : []),
  ];
}

/** All prefix matches, ordered by exact airport code, then cities, countries, airports. */
export function suggestPlaces(
  text: string,
  catalogue: Catalogue | undefined,
  field: PlaceField,
  selected: readonly string[] = [],
  excluded: readonly string[] = [],
  language = 'en',
  anywhere?: AnywhereLabel,
): PlaceSuggestion[] {
  if (!catalogue || selected.some((value) => readPlaceValue(value)?.kind === 'anywhere')) return [];
  const all = cataloguePlaces(catalogue, field, language, anywhere);
  const selectedAirports = new Set(
    all.filter((p) => selected.includes(p.value)).flatMap((p) => p.airports),
  );
  const excludedAirports = new Set(
    cataloguePlaces(catalogue, 'exclusions', language)
      .filter((p) => excluded.includes(p.value))
      .flatMap((p) => p.airports),
  );
  const needle = folded(text.trim());
  const matches = (name: string) => {
    const words = folded(name).split(/[^\p{L}\p{N}]+/u);
    const query = needle.split(/[^\p{L}\p{N}]+/u).join(' ');
    return words.some((_, i) => words.slice(i).join(' ').startsWith(query));
  };
  const rank = (p: PlaceSuggestion) =>
    p.kind === 'airport' && needle.length === 3 && folded(p.code) === needle
      ? -1
      : { anywhere: 0, city: 1, country: 2, airport: 3 }[p.kind];
  return all
    .filter(
      (p) =>
        !selected.includes(p.value) &&
        !excluded.includes(p.value) &&
        !(
          p.airports.length &&
          p.airports.every((a) => selectedAirports.has(a) || excludedAirports.has(a))
        ) &&
        (!needle ||
          (p.kind === 'airport' && folded(p.code).startsWith(needle)) ||
          p.names.some(matches)),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) || a.name.localeCompare(b.name, language) || a.code.localeCompare(b.code),
    );
}

/** Restore exact legacy text names or canonical identities; silently discard stale/unknown places. */
export function restorePlaces(
  value: unknown,
  catalogue: Catalogue,
  field: PlaceField,
  anywhere?: AnywhereLabel,
): string {
  if (typeof value !== 'string') return '';
  const all = cataloguePlaces(catalogue, field, 'en', anywhere);
  const restored: PlaceSelection[] = [];
  for (const token of placeTokens(value)) {
    const identity = readPlaceValue(token);
    const p =
      all.find((p) => identity && p.value === placeValue(identity)) ??
      all.find((p) => p.names.some((n) => folded(n) === folded(token)));
    if (!p) continue;
    if (p.kind === 'anywhere') return writePlaceSelections([p]);
    const places =
      field === 'homeAirports' && p.kind === 'country'
        ? p.airports.map((code): PlaceSelection => ({ kind: 'airport', code }))
        : [p];
    for (const place of places)
      if (!restored.some((p) => placeValue(p) === placeValue(place))) restored.push(place);
  }
  return writePlaceSelections(restored);
}
