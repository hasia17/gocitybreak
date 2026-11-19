import { Offer } from './search-api';
import { fillSearch, renderSearch, useAnimatedSearch } from './search-testing';

/**
 * Offers stagger in after a new search only (#83, spec #79), with Angular animations switched on.
 * jsdom runs no CSS animations, so these specs pin the decision, not the motion: the offer list
 * carries `data-stagger` exactly while its offers are to stagger in. Offers and groups added with
 * "Show more" fade in together instead (#88): they carry `data-added`. The timing is checked by hand.
 */
describe('Search offers motion', () => {
  const harness = useAnimatedSearch();

  function offers(count: number, to = 'BGY'): Offer[] {
    const fetchedAt = new Date().toISOString();
    return Array.from({ length: count }, (_, index) => {
      const flight = {
        airline: 'ryanair' as const,
        departureAirport: 'KRK',
        arrivalAirport: to,
        departure: { date: '2026-12-04', time: '10:00', timeZone: 'Europe/Warsaw' },
        arrival: { date: '2026-12-04', time: '12:00', timeZone: 'Europe/Rome' },
        originalPrice: { amount: 100 + index, currency: 'PLN' },
        fetchedAt,
      };
      return {
        kind: 'roundTrip',
        outbound: { isDirect: true, flights: [flight] },
        inbound: {
          isDirect: true,
          flights: [{ ...flight, departureAirport: to, arrivalAirport: 'KRK' }],
        },
        nights: 2,
        price: { amount: 100 + index, currency: 'PLN', approximate: false },
        priceFetchedAt: fetchedAt,
        leaveDays: count - index,
      };
    });
  }

  async function setup(destination = 'BGY') {
    const { fixture, root } = await renderSearch();
    fillSearch(root, destination);
    const search = async (found: Offer[]) => {
      root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      harness.http.expectOne('/api/search').flush({ offers: found });
      await fixture.whenStable();
    };
    const staggering = () => root.querySelector('app-offer-list')?.hasAttribute('data-stagger');
    const sortBy = async (order: string) => {
      root
        .querySelector<HTMLInputElement>(`[aria-label="Sort by"] input[value="${order}"]`)!
        .click();
      await fixture.whenStable();
    };
    const more = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('[data-testid="results"] button')).find(
        (b) => b.textContent?.trim().startsWith('Show more'),
      );
    return { fixture, root, search, staggering, sortBy, more };
  }

  it('staggers a flat list after a new search, and every new search again', async () => {
    const { search, staggering, sortBy } = await setup();
    await search(offers(5));
    expect(staggering()).toBe(true);
    await sortBy('leaveDays');
    expect(staggering()).toBe(false);
    await search(offers(5));
    expect(staggering()).toBe(true);
  });

  it('shows the offers at once after a sort change', async () => {
    const { search, staggering, sortBy } = await setup();
    await search(offers(5));
    await sortBy('leaveDays');
    expect(staggering()).toBe(false);
    await sortBy('price');
    expect(staggering()).toBe(false);
  });

  it('staggers the first eight offers, the rest entering with the eighth', async () => {
    const { root, search } = await setup();
    await search(offers(12));
    const index = (row: Element) => row.closest('li')?.style.getPropertyValue('--enter-index');
    const rows = Array.from(root.querySelectorAll('[data-testid="offer"]'));
    expect(rows.map(index)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '7', '7', '7', '7']);
  });

  it('shows the offers at once after a page change', async () => {
    const { fixture, root, search, more } = await setup();
    await search(offers(45));
    more()!.click();
    await fixture.whenStable();
    const rows = Array.from(root.querySelectorAll('[data-testid="offer"]'));
    expect(rows).toHaveLength(40);
    const entering = rows.filter((row) =>
      row.closest('li')?.style.getPropertyValue('--enter-index'),
    );
    expect(entering).toHaveLength(20);
    expect(rows.slice(20).some((row) => entering.includes(row))).toBe(false);
  });

  it('stops marking the list for the stagger once a page is added, until the next search', async () => {
    const { fixture, search, staggering, more } = await setup();
    await search(offers(45));
    expect(staggering()).toBe(true);
    more()!.click();
    await fixture.whenStable();
    expect(staggering()).toBe(false);
    await search(offers(45));
    expect(staggering()).toBe(true);
  });

  it('stops marking destination groups for the stagger once a page is added', async () => {
    const { fixture, root, search, staggering, more } = await setup('anywhere');
    const found = Array.from({ length: 25 }, (_, i) =>
      offers(1, `X${String(i).padStart(2, '0')}`),
    ).flat();
    await search(found);
    expect(root.querySelectorAll('[data-testid="group"]').length).toBeGreaterThan(1);
    expect(staggering()).toBe(true);
    more()!.click();
    await fixture.whenStable();
    expect(staggering()).toBe(false);
  });

  it('fades in the offers added with "Show more" together, but not the first page', async () => {
    const { fixture, root, search, more } = await setup();
    await search(offers(45));
    const fading = () =>
      Array.from(root.querySelectorAll('[data-testid="offer"]')).map((row) =>
        row.hasAttribute('data-added'),
      );
    expect(fading()).toEqual(Array(20).fill(false));
    more()!.click();
    await fixture.whenStable();
    expect(fading()).toEqual([...Array(20).fill(false), ...Array(20).fill(true)]);
    more()!.click();
    await fixture.whenStable();
    expect(fading()).toEqual([...Array(20).fill(false), ...Array(25).fill(true)]);
  });

  it('staggers the offers of a new search after "Show more", none of them fading in', async () => {
    const { fixture, root, search, staggering, more } = await setup();
    await search(offers(45));
    more()!.click();
    await fixture.whenStable();
    await search(offers(45));
    expect(staggering()).toBe(true);
    expect(root.querySelectorAll('[data-testid="offer"]')).toHaveLength(20);
    expect(root.querySelectorAll('[data-added]')).toHaveLength(0);
  });

  it('fades in the destination groups added with "Show more" together, but not the first page', async () => {
    const { fixture, root, search, more } = await setup('anywhere');
    const found = Array.from({ length: 25 }, (_, i) =>
      offers(1, `X${String(i).padStart(2, '0')}`),
    ).flat();
    await search(found);
    const fading = () =>
      Array.from(root.querySelectorAll('[data-testid="group"]')).map((group) =>
        group.hasAttribute('data-added'),
      );
    expect(fading()).toEqual(Array(20).fill(false));
    more()!.click();
    await fixture.whenStable();
    expect(fading()).toEqual([...Array(20).fill(false), ...Array(5).fill(true)]);
  });

  it('staggers destination groups the same way, but not after a sort change', async () => {
    const { search, staggering, sortBy, root } = await setup('anywhere');
    await search([...offers(3, 'BGY'), ...offers(3, 'KTW')]);
    expect(root.querySelectorAll('[data-testid="group"]').length).toBeGreaterThan(1);
    expect(staggering()).toBe(true);
    await sortBy('leaveDays');
    expect(staggering()).toBe(false);
  });

  it('staggers the offers found by a suggestion chosen from the no-offers message', async () => {
    const { fixture, root, search, staggering } = await setup();
    await search([]);
    expect(root.querySelector('[data-testid="no-offers"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="suggestion"]')!.click();
    harness.http.expectOne('/api/search').flush({ offers: offers(5) });
    await fixture.whenStable();
    expect(staggering()).toBe(true);
  });
});
