import { renderSearch, useAnimatedSearch } from './search-testing';

/** The form folding into the summary bar and back, with Angular animations switched on (#81, spec #79). */
describe('Search form and summary bar motion', () => {
  const harness = useAnimatedSearch();

  async function search() {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        homeAirports: 'KRK',
        destination: 'anywhere',
        from: '2026-12-20',
        to: '2026-12-31',
      }),
    );
    const { fixture, root } = await renderSearch();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    harness.http.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();
    return { fixture, root };
  }

  it('shows the summary bar and keeps the folding form out of Tab after a search', async () => {
    const { root } = await search();
    expect(root.querySelector('[data-testid="summary"]')).not.toBeNull();
    expect(root.querySelector('.hero')!.closest('[inert]')).not.toBeNull();
  });

  it('brings the form back with its values and focus on its heading, and removes the summary bar', async () => {
    const { fixture, root } = await search();
    root.querySelector<HTMLButtonElement>('[data-testid="summary"] button')!.click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(root.querySelector('[data-testid="summary"]')).toBeNull();
    expect(root.querySelector('.hero')!.closest('[hidden], [inert]')).toBeNull();
    expect(root.querySelector('.hero h1')).toBe(document.activeElement);
    expect(root.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-12-20');
  });

  it('keeps the summary bar out of Tab while it plays out, and only then', async () => {
    const { fixture, root } = await search();
    const slot = root.querySelector('[data-testid="summary"]')!.parentElement!;
    expect(slot.hasAttribute('inert')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-testid="summary"] button')!.click();
    await fixture.whenStable();
    expect(slot.hasAttribute('inert')).toBe(true);
  });
});
