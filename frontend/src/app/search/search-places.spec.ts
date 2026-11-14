import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Catalogue } from './search-api';
import { removeAnywhere } from './place-testing';

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
useSearchClock();

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
  it.each(['server', 'network'])(
    'recovers from a %s failure loading places without reloading',
    async (failure) => {
      localStorage.setItem(
        'gocitybreak.searchSettings.v1',
        JSON.stringify({
          homeAirports: 'KRK, Atlantis',
          destination: 'Mediolan',
          from: '2026-12-01',
          to: '2026-12-10',
        }),
      );
      const fixture = TestBed.createComponent(Search);
      const initial = http.expectOne('/api/catalogue');
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      const submit = () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit().disabled).toBe(true);
      expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading places');
      expect(root.querySelector<HTMLInputElement>('[aria-label="From"]')!.disabled).toBe(true);
      root
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      http.expectNone('/api/search');
      if (failure === 'server') initial.flush({}, { status: 503, statusText: 'Unavailable' });
      else initial.error(new ProgressEvent('error'));
      await fixture.whenStable();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Could not load places');
      expect(submit().disabled).toBe(true);
      const retry = Array.from(root.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Retry',
      )!;
      expect(retry).toBeDefined();
      retry.click();
      retry.click();
      const recovery = http.expectOne('/api/catalogue');
      await fixture.whenStable();
      expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading places');
      recovery.flush(catalogue);
      await fixture.whenStable();
      expect(root.querySelector('[data-place-chip="KRK"]')).not.toBeNull();
      expect(root.querySelector('[data-place-chip="city:MILAN"]')).not.toBeNull();
      expect(root.textContent).not.toContain('Atlantis');
      expect(submit().disabled).toBe(false);
      TestBed.inject(TranslocoService).setActiveLang('pl');
      await fixture.whenStable();
      http.expectNone('/api/catalogue');
      submit().click();
      const search = http.expectOne('/api/search');
      expect(search.request.body).toMatchObject({
        homeAirports: ['KRK'],
        destination: { cities: ['MILAN'] },
      });
      search.flush({ offers: [] });
    },
  );
  it('selects listed places with the keyboard and submits stable codes', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    removeAnywhere(root);
    await fixture.whenStable();
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
  it.each(['To', 'Except'])(
    'shows the airports a city covers in its %s suggestion and chip',
    async (field) => {
      const fixture = TestBed.createComponent(Search);
      http.expectOne('/api/catalogue').flush({
        ...catalogue,
        airports: [
          ...catalogue.airports,
          { code: 'MXP', name: 'Milan Malpensa', cities: ['MILAN'], country: 'it' },
        ],
        cities: [{ ...catalogue.cities[0], airports: ['BGY', 'MXP'] }],
      });
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      removeAnywhere(root);
      await fixture.whenStable();
      const input = root.querySelector<HTMLInputElement>(
        `[role="combobox"][aria-label="${field}"]`,
      )!;
      input.value = 'Milan';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      const city = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
        (o) => o.textContent?.includes('city'),
      )!;
      expect(city.textContent?.trim()).toBe('Milan, Italy — city · BGY, MXP');
      city.click();
      await fixture.whenStable();
      const chip = root.querySelector('[data-place-chip="city:MILAN"]')!;
      expect(chip.getAttribute('title')).toBe('BGY, MXP');
      expect(chip.querySelector('.city-airports')?.textContent).toBe('(BGY, MXP)');
    },
  );
  it.each(['en', 'pl'])(
    'shows each airport suggestion once as code, name and country in %s, announced as an airport',
    async (language) => {
      const fixture = TestBed.createComponent(Search);
      http.expectOne('/api/catalogue').flush({
        ...catalogue,
        airports: [
          ...catalogue.airports,
          { code: 'MXP', name: 'Milan Malpensa', cities: ['MILAN'], country: 'it' },
        ],
      });
      TestBed.inject(TranslocoService).setActiveLang(language);
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      removeAnywhere(root);
      const to = root.querySelector<HTMLInputElement>(
        'app-place-chips[field="destination"] input',
      )!;
      to.value = 'MXP';
      to.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      const option = root.querySelector<HTMLButtonElement>('[role="option"]')!;
      const text = option.textContent?.trim();
      expect(text).toBe(
        language === 'en' ? 'MXP Milan Malpensa, Italy' : 'MXP Milan Malpensa, Włochy',
      );
      expect(option.getAttribute('aria-label')).toBe(
        language === 'en' ? `${text} — airport` : `${text} — lotnisko`,
      );
    },
  );
  it('shows a place field placeholder only while the field holds no place', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const from = root.querySelector<HTMLInputElement>(
      'app-place-chips[field="homeAirports"] input',
    )!;
    expect(from.placeholder).not.toBe('');
    from.value = 'KRK';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    expect(from.placeholder).toBe('');
    root.querySelector<HTMLButtonElement>('[data-place-chip="KRK"] button')!.click();
    await fixture.whenStable();
    expect(from.placeholder).not.toBe('');
  });
  it('removes chips with Backspace and the named remove button, without submitting typed text', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    removeAnywhere(root);
    await fixture.whenStable();
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
  it('shows the example placeholder only while no place is chosen', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const from = root.querySelector<HTMLInputElement>('[aria-label="From"]')!;
    expect(from.placeholder).toBe('KRK, KTW');
    from.value = 'KRK';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    expect(from.placeholder).toBe('');
    root.querySelector<HTMLButtonElement>('button[aria-label^="Remove KRK"]')!.click();
    await fixture.whenStable();
    expect(from.placeholder).toBe('KRK, KTW');
  });
  it('keeps the field one row tall, listing the places beyond the first two behind "+N"', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    removeAnywhere(root);
    await fixture.whenStable();
    const to = root.querySelector<HTMLInputElement>('[aria-label="To"]')!;
    const field = to.closest('app-place-chips')!;
    const choose = async (name: string) => {
      to.value = name;
      to.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      field.querySelector<HTMLButtonElement>('[role="option"]')!.click();
      await fixture.whenStable();
    };
    const chips = () =>
      Array.from(field.querySelectorAll('[data-place-chip]')).map((c) =>
        c.getAttribute('data-place-chip'),
      );
    const listed = () =>
      Array.from(field.querySelectorAll('[data-chosen-place]')).map((c) =>
        c.getAttribute('data-chosen-place'),
      );
    const more = () => field.querySelector<HTMLButtonElement>('button[aria-expanded]');
    for (const name of ['Milan', 'KRK', 'KTW']) await choose(name);
    expect(chips()).toEqual(['city:MILAN', 'KRK']);
    expect(more()!.textContent!.trim()).toBe('+1');
    expect(more()!.getAttribute('aria-label')).toBe('1 more: KTW Katowice');
    expect(listed()).toEqual([]);

    more()!.click();
    await fixture.whenStable();
    expect(more()!.getAttribute('aria-expanded')).toBe('true');
    expect(listed()).toEqual(['city:MILAN', 'KRK', 'KTW']);
    document.body.click();
    await fixture.whenStable();
    expect(listed()).toEqual([]);

    more()!.click();
    await fixture.whenStable();
    field.querySelector<HTMLButtonElement>('[data-chosen-place="KRK"] button')!.click();
    await fixture.whenStable();
    expect(chips()).toEqual(['city:MILAN', 'KTW']);
    expect(more()).toBeNull();
    expect(listed()).toEqual([]);

    await choose('KRK');
    more()!.click();
    await fixture.whenStable();
    Array.from(field.querySelectorAll<HTMLButtonElement>('.chosen-list button'))
      .find((b) => b.textContent!.trim() === 'Clear all')!
      .click();
    await fixture.whenStable();
    expect(chips()).toEqual([]);
    expect(more()).toBeNull();
  });
  it('takes the Anywhere label and cross-language matches from the runtime dictionaries', async () => {
    const translations = TestBed.inject(TranslocoService);
    translations.setTranslation({ places: { anywhere: 'Every destination' } }, 'en', {
      merge: true,
    });
    translations.setTranslation({ places: { anywhere: 'Wszystkie miejsca' } }, 'pl', {
      merge: true,
    });
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    removeAnywhere(root);
    await fixture.whenStable();
    for (const language of ['en', 'pl']) {
      translations.setActiveLang(language);
      await fixture.whenStable();
      const to = root.querySelector<HTMLInputElement>(
        'app-place-chips[field="destination"] input',
      )!;
      for (const text of ['Every', 'Wszystkie']) {
        to.value = text;
        to.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        const options = root.querySelectorAll('[role="option"]');
        expect(options).toHaveLength(1);
        expect(options[0].textContent?.trim()).toBe(
          language === 'en' ? 'Every destination' : 'Wszystkie miejsca',
        );
      }
    }
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-place-chip="anywhere"]')?.textContent).toContain(
      'Wszystkie miejsca',
    );
  });
  it('replaces destination chips when Anywhere is chosen', async () => {
    const fixture = TestBed.createComponent(Search);
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    removeAnywhere(root);
    await fixture.whenStable();
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
    removeAnywhere(root);
    await fixture.whenStable();
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
