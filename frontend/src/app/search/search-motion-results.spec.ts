import { vi } from 'vitest';
import roundTripResponse from '../../../../contract/round-trip.response.json';
import { fillSearch, renderSearch, useAnimatedSearch } from './search-testing';

/**
 * The skeleton hands over to the results (#82, spec #79), with Angular animations switched on.
 * jsdom has no Web Animations, so Angular runs no animate.enter / animate.leave here: these specs
 * pin the DOM outcome of the handover; the crossfade itself is checked by hand in the browser.
 */
describe('Search results handover', () => {
  const harness = useAnimatedSearch();

  async function setup() {
    const { fixture, root } = await renderSearch();
    fillSearch(root);
    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const start = async () => {
      submit.click();
      const request = harness.http.expectOne('/api/search');
      await fixture.whenStable();
      return request;
    };
    return { fixture, root, start };
  }
  const skeleton = (root: HTMLElement) => root.querySelector('[data-testid="skeleton"]');

  it('replaces the skeleton with the offers, on every new search', async () => {
    const { fixture, root, start } = await setup();
    for (let i = 0; i < 2; i++) {
      const request = await start();
      expect(skeleton(root)).not.toBeNull();
      expect(root.querySelectorAll('[data-testid="offer"]')).toHaveLength(0);
      request.flush(roundTripResponse);
      await fixture.whenStable();
      await vi.waitFor(() => expect(skeleton(root)).toBeNull());
      expect(root.querySelectorAll('[data-testid="offer"]').length).toBeGreaterThan(0);
    }
  });

  it('replaces the skeleton with the no-offers message', async () => {
    const { fixture, root, start } = await setup();
    (await start()).flush({ offers: [] });
    await fixture.whenStable();
    await vi.waitFor(() => expect(skeleton(root)).toBeNull());
    expect(root.querySelector('[data-testid="no-offers"]')).not.toBeNull();
  });

  it('announces progress outside the animated region and keeps the live region in place', async () => {
    const { fixture, root, start } = await setup();
    const request = await start();
    const progress = root.querySelector('[role="status"]')!;
    const results = root.querySelector('[data-testid="results"]')!;
    expect(progress.textContent?.trim()).toBe('Searching for offers…');
    expect(results.contains(progress)).toBe(false);
    expect(results.getAttribute('aria-live')).toBe('polite');
    request.flush(roundTripResponse);
    await fixture.whenStable();
    expect(progress.textContent?.trim()).toBe('');
    expect(results.getAttribute('aria-live')).toBe('polite');
    expect(results.getAttribute('aria-busy')).toBe('false');
  });
});
