import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { Search } from './search';
import { SearchQuery } from './search-api';
import { useSearchClock } from './search-testing';

/** What an empty result offers the user, through the search DOM and HTTP boundary (#64). */
useSearchClock();

describe('Search empty result', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match('/api/catalogue');
    http.verify();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }
  function type(root: HTMLElement, name: string, value: string) {
    const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function choose(root: HTMLElement, value: string) {
    root.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click();
  }
  /** Search with these fields and answer that nothing was found. */
  async function searchEmpty(
    fields: {
      kind?: 'oneWay';
      mode?: 'fixed';
      destination?: string;
      exclusions?: string;
    } = {},
  ) {
    const { fixture, root } = await render();
    if (fields.kind) choose(root, fields.kind);
    if (fields.mode) choose(root, fields.mode);
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', fields.destination ?? 'anywhere');
    if (fields.exclusions) fillPlace(root, 'Except', fields.exclusions);
    type(root, 'from', '2026-12-01');
    if (fields.kind !== 'oneWay') type(root, 'to', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    http.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();
    return { fixture, root };
  }
  const suggestions = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-testid="suggestion"]')).map(
      (el) => el.dataset['suggestion'],
    );
  /** Press a suggestion and return the request it sends. */
  async function press(
    fixture: { whenStable(): Promise<unknown> },
    root: HTMLElement,
    id: string,
  ): Promise<SearchQuery> {
    root.querySelector<HTMLButtonElement>(`[data-suggestion="${id}"]`)!.click();
    const request = http.expectOne('/api/search');
    const body = request.request.body as SearchQuery;
    request.flush({ offers: [] });
    await fixture.whenStable();
    return body;
  }

  it('names the route and the dates that found nothing, in both languages', async () => {
    const { fixture, root } = await searchEmpty({ destination: 'BGY' });
    const empty = root.querySelector('[data-testid="empty"]')!;
    expect(empty.querySelector('h2')?.textContent).toBe('No offers for Kraków → Milan Bergamo');
    expect(empty.querySelector('p')?.textContent).toContain('Tue 1 Dec 2026 – Thu 10 Dec 2026');

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(empty.querySelector('h2')?.textContent).toBe(
      'Brak ofert na trasie Kraków → Milan Bergamo',
    );
    expect(empty.querySelector('p')?.textContent).toContain('wt 1 gru 2026 – czw 10 gru 2026');
  });

  it('names Anywhere as the destination', async () => {
    const { root } = await searchEmpty();
    expect(root.querySelector('[data-testid="empty"] h2')?.textContent).toBe(
      'No offers for Kraków → Anywhere',
    );
  });

  it('offers only the changes that apply to a flexible round trip to a narrower place', async () => {
    const { root } = await searchEmpty({ destination: 'BGY' });
    expect(suggestions(root)).toEqual(['widenWindow', 'moreNights', 'anywhere']);
  });

  it('offers to remove exclusions only when there are some, and Anywhere only for a narrower destination', async () => {
    const { root } = await searchEmpty({ destination: 'BGY', exclusions: 'KTW' });
    expect(suggestions(root)).toEqual([
      'widenWindow',
      'moreNights',
      'removeExclusions',
      'anywhere',
    ]);
  });

  it('offers neither Anywhere nor exclusion removal for a plain Anywhere search', async () => {
    const { root } = await searchEmpty();
    expect(suggestions(root)).toEqual(['widenWindow', 'moreNights']);
  });

  it('offers no night suggestion for a one way search', async () => {
    const { root } = await searchEmpty({ kind: 'oneWay', destination: 'BGY' });
    expect(suggestions(root)).toEqual(['widenWindow', 'anywhere']);
  });

  it('offers flexible dates, not a wider window, for fixed dates', async () => {
    const { root } = await searchEmpty({ mode: 'fixed', destination: 'BGY' });
    expect(suggestions(root)).toEqual(['flexibleDates', 'anywhere']);
  });

  it('widens the window by 14 days in the form and searches again', async () => {
    const { fixture, root } = await searchEmpty({ destination: 'BGY' });
    const body = await press(fixture, root, 'widenWindow');
    expect(body.travelWindow).toEqual({ from: '2026-12-01', to: '2026-12-24' });
    expect(root.querySelector<HTMLInputElement>('input[formControlName="to"]')!.value).toBe(
      '2026-12-24',
    );
  });

  it('allows one more night on each side', async () => {
    const { fixture, root } = await searchEmpty({ destination: 'BGY' });
    const body = await press(fixture, root, 'moreNights');
    expect(body.stayLength).toEqual({ min: 1, max: 4 });
  });

  it('removes the exclusions', async () => {
    const { fixture, root } = await searchEmpty({ destination: 'BGY', exclusions: 'KTW' });
    const body = await press(fixture, root, 'removeExclusions');
    expect(body.exclusions).toBeUndefined();
    expect(suggestions(root)).not.toContain('removeExclusions');
  });

  it('searches Anywhere', async () => {
    const { fixture, root } = await searchEmpty({ destination: 'BGY' });
    const body = await press(fixture, root, 'anywhere');
    expect(body.destination).toEqual({ anywhere: true });
  });

  it('searches flexible dates around fixed dates', async () => {
    const { fixture, root } = await searchEmpty({ mode: 'fixed', destination: 'BGY' });
    const body = await press(fixture, root, 'flexibleDates');
    expect(body.fixedDates).toBeUndefined();
    expect(body.travelWindow).toEqual({ from: '2026-11-28', to: '2026-12-13' });
    expect(body.stayLength).toEqual({ min: 8, max: 10 });
    expect(root.querySelector<HTMLInputElement>('input[value="flexible"]')!.checked).toBe(true);
  });

  it('offers nothing before a search came back empty', async () => {
    const { fixture, root } = await render();
    expect(suggestions(root)).toEqual([]);
    fillPlace(root, 'From', 'KRK');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    http.expectOne('/api/search');
    await fixture.whenStable();
    expect(suggestions(root)).toEqual([]);
  });
});
