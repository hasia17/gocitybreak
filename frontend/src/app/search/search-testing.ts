import { afterEach, beforeEach, vi } from 'vitest';

/** Keep the 2026 search fixtures in the future while Angular's scheduling stays real. */
export function useSearchClock() {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 1, 12).getTime());
  });
  afterEach(() => vi.restoreAllMocks());
}
