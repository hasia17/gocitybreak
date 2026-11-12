import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Catalogue } from './search-api';

const catalogue: Catalogue = {
  supportedAirports: [
    { code: 'KRK', name: 'Kraków' },
    { code: 'KTW', name: 'Katowice' },
  ],
  airports: [
    { code: 'KRK', name: 'Kraków', cities: [], country: 'pl' },
    { code: 'KTW', name: 'Katowice', cities: [], country: 'pl' },
    { code: 'BGY', name: 'Bergamo', names: { pl: 'Bergamo' }, cities: ['MILAN'], country: 'it' },
  ],
  cities: [
    { code: 'MILAN', name: 'Milan', names: { pl: 'Mediolan' }, airports: ['BGY'], country: 'it' },
  ],
  countries: [
    { code: 'pl', name: 'Poland', names: { pl: 'Polska' } },
    { code: 'it', name: 'Italy', names: { pl: 'Włochy' } },
  ],
};
describe('Search place chips', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('selects listed places with the keyboard and submits stable codes', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const from = root.querySelector<HTMLInputElement>('[role="combobox"][aria-label="From"]');
    expect(from).not.toBeNull();
    from!.value = 'Pol';
    from!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(from!.getAttribute('aria-expanded')).toBe('true');
    from!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(from!.getAttribute('aria-activedescendant')).toBe(
      root.querySelector('[role="option"]')!.id,
    );
    from!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(root.querySelectorAll('[data-place-chip]').length).toBe(2);
    const to = root.querySelector<HTMLInputElement>('[role="combobox"][aria-label="To"]')!;
    to.value = 'Medi';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(root.querySelector('[data-place-chip="city:MILAN"]')!.textContent).toContain('Mediolan');
    const dates = root.querySelectorAll<HTMLInputElement>('input[type="date"]');
    ['2026-12-01', '2026-12-10'].forEach((date, i) => {
      dates[i].value = date;
      dates[i].dispatchEvent(new Event('input'));
    });
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(http.expectOne('/api/search').request.body).toMatchObject({
      homeAirports: ['KRK', 'KTW'],
      destination: { cities: ['MILAN'] },
    });
  });
  it('removes chips with Backspace and the named remove button, without submitting typed text', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const from = root.querySelector<HTMLInputElement>('[aria-label="From"]')!;
    from.value = 'KRK';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await fixture.whenStable();
    expect(root.querySelector('[data-place-chip]')).toBeNull();
    const to = root.querySelector<HTMLInputElement>('[aria-label="To"]')!;
    to.value = 'Milan';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('button[aria-label="Remove Milan"]')!.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-place-chip]')).toBeNull();
    to.value = 'Atlantis';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(root.querySelector('[role="option"]')).toBeNull();
    to.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(to.getAttribute('aria-invalid')).toBe('true');
  });
  it('replaces destination chips when Anywhere is chosen', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const to = root.querySelector<HTMLInputElement>('[aria-label="To"]')!;
    for (const text of ['Milan', 'any']) {
      to.value = text;
      to.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
      await fixture.whenStable();
    }
    expect(root.querySelector('[data-place-chip="anywhere"]')).not.toBeNull();
    expect(root.querySelector('[data-place-chip="city:MILAN"]')).toBeNull();
  });
  it('migrates known old settings and drops unknown and unsupported places after catalogue loading', async () => {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        homeAirports: 'KRK, BGY, Atlantis',
        destination: 'Mediolan, Unknown',
        exclusions: 'Włochy, nowhere',
      }),
    );
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      Array.from(root.querySelectorAll('[data-place-chip]')).map((p) =>
        p.getAttribute('data-place-chip'),
      ),
    ).toEqual(['KRK', 'city:MILAN', 'country:it']);
    const dates = root.querySelectorAll<HTMLInputElement>('input[type="date"]');
    ['2026-12-01', '2026-12-10'].forEach((date, i) => {
      dates[i].value = date;
      dates[i].dispatchEvent(new Event('input'));
    });
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(http.expectOne('/api/search').request.body).toMatchObject({
      homeAirports: ['KRK'],
      destination: { cities: ['MILAN'] },
      exclusions: { countries: ['it'] },
    });
  });
  it('opens at the last suggestion with ArrowUp and removes choices covered by exclusions', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const except = root.querySelector<HTMLInputElement>('[aria-label="Except"]')!;
    except.value = 'Italy';
    except.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    const to = root.querySelector<HTMLInputElement>('[aria-label="To"]')!;
    to.value = '';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const options = Array.from(root.querySelectorAll('[role="option"]'));
    expect(options.some((o) => o.textContent?.includes('Milan'))).toBe(false);
    expect(options.some((o) => o.textContent?.includes('Bergamo'))).toBe(false);
    expect(options.some((o) => o.textContent?.includes('Anywhere'))).toBe(true);
    to.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await fixture.whenStable();
    expect(to.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    to.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(to.getAttribute('aria-expanded')).toBe('false');
    expect(to.hasAttribute('aria-activedescendant')).toBe(false);
    http.expectNone('/api/search');
  });
});
