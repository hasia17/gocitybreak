const dayMs = 86_400_000;

/** The ISO date `days` days after (or, if negative, before) `isoDate`. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * dayMs).toISOString().slice(0, 10);
}

/** The whole days from one ISO date to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / dayMs);
}
