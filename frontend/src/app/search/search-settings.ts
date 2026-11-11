/**
 * The last search settings, remembered in the browser so the user does not re-enter them.
 * Storage may be empty, full, corrupted or blocked (e.g. private mode); every failure falls back
 * to the form's defaults.
 */

const key = 'gocitybreak.searchSettings.v1';

/** The search form's raw value as last searched, or undefined when nothing usable is stored. */
export function loadSearchSettings(): Record<string, unknown> | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
    return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers the search form's raw value; silently does nothing when storage is unavailable. */
export function saveSearchSettings(settings: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Remembering is a convenience: the search itself must not fail without it.
  }
}
