/** The catalogue name in the interface language, falling back to the original name. */
export function catalogueName(
  place: { name: string; names?: Record<string, string> },
  language: string,
): string {
  return place.names?.[language] ?? place.name;
}
