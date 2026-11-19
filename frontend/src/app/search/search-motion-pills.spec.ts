import { Offer } from './search-api';
import { fillSearch, renderSearch, useAnimatedSearch } from './search-testing';

/**
 * The pill toggles slide one shared fill to the chosen option (spec #88). jsdom runs no CSS
 * transitions, so the slide is checked by hand; these specs pin that switching an option, by
 * click or arrow key, leaves focus on the option the traveller chose.
 */
describe('Search pill toggle motion', () => {
  const harness = useAnimatedSearch();

  function offer(): Offer {
    const fetchedAt = new Date().toISOString();
    const flight = {
      airline: 'ryanair' as const,
      departureAirport: 'KRK',
      arrivalAirport: 'BGY',
      departure: { date: '2026-12-04', time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date: '2026-12-04', time: '12:00', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 100, currency: 'PLN' },
      fetchedAt,
    };
    return {
      kind: 'roundTrip',
      outbound: { isDirect: true, flights: [flight] },
      inbound: {
        isDirect: true,
        flights: [{ ...flight, departureAirport: 'BGY', arrivalAirport: 'KRK' }],
      },
      nights: 2,
      price: { amount: 100, currency: 'PLN', approximate: false },
      priceFetchedAt: fetchedAt,
      leaveDays: 1,
    };
  }

  function option(root: HTMLElement, group: string, value: string): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(`[aria-label="${group}"] input[value="${value}"]`)!;
  }

  it.each([
    ['Kind of offer', 'oneWay'],
    ['Dates', 'fixed'],
  ])('keeps focus on the chosen option of the %s pill', async (group, value) => {
    const { fixture, root } = await renderSearch();
    const chosen = option(root, group, value);
    // A click or an arrow key focuses the option it checks.
    chosen.focus();
    chosen.click();
    await fixture.whenStable();

    expect(chosen.checked).toBe(true);
    expect(document.activeElement).toBe(chosen);
  });

  it('keeps focus on the chosen option of the sort pill', async () => {
    const { fixture, root } = await renderSearch();
    fillSearch(root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    harness.http.expectOne('/api/search').flush({ offers: [offer()] });
    await fixture.whenStable();

    const chosen = option(root, 'Sort by', 'leaveDays');
    chosen.focus();
    chosen.click();
    await fixture.whenStable();

    expect(chosen.checked).toBe(true);
    expect(document.activeElement).toBe(chosen);
  });
});
