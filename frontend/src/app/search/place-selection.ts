/** Language-independent identity of a selected catalogue entry or the Anywhere choice. */
export interface PlaceSelection {
  kind: 'airport' | 'city' | 'country' | 'anywhere';
  code: string;
}

/** The existing CSV form/settings format stays compatible; only this codec owns its encoding. */
export function placeValue(place: PlaceSelection): string {
  switch (place.kind) {
    case 'anywhere':
      return 'anywhere';
    case 'airport':
      return place.code;
    default:
      return `${place.kind}:${place.code}`;
  }
}

/** Decode an identity, without claiming that it exists in the current catalogue. */
export function readPlaceValue(value: string): PlaceSelection | undefined {
  if (value.toLowerCase() === 'anywhere') return { kind: 'anywhere', code: '' };
  const named = /^(city|country):(.+)$/.exec(value);
  if (named) return { kind: named[1] as 'city' | 'country', code: named[2] };
  if (/^[a-z]{3}$/i.test(value)) return { kind: 'airport', code: value.toUpperCase() };
  return undefined;
}

/** Tokens can still be legacy names until restoration validates them against the catalogue. */
export function placeTokens(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

export function readPlaceSelections(value: unknown): PlaceSelection[] {
  return placeTokens(value)
    .map(readPlaceValue)
    .filter((p) => p !== undefined);
}

export function writePlaceSelections(places: readonly PlaceSelection[]): string {
  return places.map(placeValue).join(', ');
}
