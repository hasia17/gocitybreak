import { useSearchClock } from './search-testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';

/** The collapsed Leave and Filters sections and the sort in the results header (#58). */
useSearchClock();

describe('Search sections', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.match('/api/catalogue');
    httpTesting.verify();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function hasSection(root: HTMLElement, name: string): boolean {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).some((b) =>
      b.textContent?.trim().startsWith(name),
    );
  }

  function section(root: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
    ).find((b) => b.textContent?.trim().startsWith(name));
    if (!found) throw new Error(`no section button ${name}`);
    return found;
  }

  /** The control with this label, wherever it is rendered; undefined when it is not rendered. */
  function field(root: HTMLElement, label: string): HTMLInputElement | undefined {
    return (
      Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input') ?? undefined
    );
  }

  function visible(el: Element | undefined): boolean {
    return !!el && !el.closest('[hidden]');
  }

  function type(root: HTMLElement, label: string, value: string) {
    const el = field(root, label)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function fillTrip(root: HTMLElement) {
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', 'BGY');
    type(root, 'Earliest', '2026-12-01');
    type(root, 'Latest', '2026-12-10');
  }

  function submit(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }

  it('shows Leave and Filters collapsed, with their controls out of view', async () => {
    const { root } = await render();
    for (const name of ['Leave', 'Filters']) {
      expect(section(root, name).getAttribute('aria-expanded')).toBe('false');
    }
    for (const label of ['Work start', 'Work end', 'Max leave days', "I don't worry about leave"])
      expect(visible(field(root, label)), label).toBe(false);
    expect(visible(field(root, 'Direct flights only'))).toBe(false);
  });

  it('opens and closes Leave and Filters with their buttons, which announce the state', async () => {
    const { fixture, root } = await render();
    section(root, 'Leave').click();
    await fixture.whenStable();
    expect(section(root, 'Leave').getAttribute('aria-expanded')).toBe('true');
    expect(visible(field(root, 'Work start'))).toBe(true);
    expect(visible(field(root, 'Direct flights only'))).toBe(false);

    section(root, 'Filters').click();
    await fixture.whenStable();
    expect(section(root, 'Filters').getAttribute('aria-expanded')).toBe('true');
    expect(visible(field(root, 'Direct flights only'))).toBe(true);

    section(root, 'Leave').click();
    await fixture.whenStable();
    expect(section(root, 'Leave').getAttribute('aria-expanded')).toBe('false');
    expect(visible(field(root, 'Work start'))).toBe(false);
  });

  it('summarises the collapsed Leave section and follows changes', async () => {
    const { fixture, root } = await render();
    expect(section(root, 'Leave').textContent).toContain('Work 9:00–17:00, no leave limit');

    section(root, 'Leave').click();
    await fixture.whenStable();
    type(root, 'Work start', '08:30');
    type(root, 'Work end', '16:00');
    type(root, 'Max leave days', '2');
    await fixture.whenStable();
    expect(section(root, 'Leave').textContent).toContain('Work 8:30–16:00, up to 2 leave days');
    type(root, 'Max leave days', '1');
    await fixture.whenStable();
    expect(section(root, 'Leave').textContent).toContain('Work 8:30–16:00, up to 1 leave day');

    field(root, "I don't worry about leave")!.click();
    await fixture.whenStable();
    expect(section(root, 'Leave').textContent).toContain("I don't worry about leave");
    expect(section(root, 'Leave').textContent).not.toContain('Work');
  });

  it('summarises the remembered leave settings in Polish', async () => {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({ leave: { workStart: '07:00', workEnd: '15:00', maxLeaveDays: 5 } }),
    );
    const { fixture, root } = await render();
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(section(root, 'Urlop').textContent).toContain('Praca 7:00–15:00, do 5 dni urlopu');
    expect(section(root, 'Filtry')).toBeTruthy();
  });

  it('hides the Leave section for one way and brings it back for a round trip', async () => {
    const { fixture, root } = await render();
    root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.click();
    await fixture.whenStable();
    expect(hasSection(root, 'Leave')).toBe(false);
    expect(hasSection(root, 'Filters')).toBe(true);
    root.querySelector<HTMLInputElement>('input[value="roundTrip"]')!.click();
    await fixture.whenStable();
    expect(hasSection(root, 'Leave')).toBe(true);
  });

  it('shows leave validation under its field when the section is open and still blocks searching', async () => {
    const { fixture, root } = await render();
    fillTrip(root);
    section(root, 'Leave').click();
    await fixture.whenStable();
    type(root, 'Max leave days', '-1');
    submit(root);
    await fixture.whenStable();
    httpTesting.expectNone('/api/search');
    const label = field(root, 'Max leave days')!.closest('label')!;
    expect(label.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('opens a closed section when its invalid field blocks a search', async () => {
    const { fixture, root } = await render();
    fillTrip(root);
    type(root, 'Max leave days', '-1');
    submit(root);
    await fixture.whenStable();
    httpTesting.expectNone('/api/search');
    expect(section(root, 'Leave').getAttribute('aria-expanded')).toBe('true');
    expect(visible(field(root, 'Max leave days'))).toBe(true);
  });

  it('shows the sort in the results header only once there are results, and keeps it', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('[aria-label="Sort by"]')).toBeNull();
    fillTrip(root);
    submit(root);
    const request = httpTesting.expectOne('/api/search');
    expect(root.querySelector('[aria-label="Sort by"]')).toBeNull();
    const fetchedAt = new Date().toISOString();
    const flight = (from: string, to: string, date: string) => ({
      departureAirport: from,
      arrivalAirport: to,
      departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 100, currency: 'PLN' },
      fetchedAt,
    });
    const offer = (price: number, leaveDays: number) => ({
      kind: 'roundTrip',
      outbound: { isDirect: true, flights: [flight('KRK', 'BGY', '2026-12-04')] },
      inbound: { isDirect: true, flights: [flight('BGY', 'KRK', '2026-12-06')] },
      nights: 2,
      leaveDays,
      price: { amount: price, currency: 'PLN', approximate: false },
      priceFetchedAt: fetchedAt,
    });
    request.flush({ offers: [offer(100, 3), offer(200, 0)] });
    await fixture.whenStable();

    const sort = root.querySelector('.results-head [aria-label="Sort by"]')!;
    expect(sort).not.toBeNull();
    expect(root.querySelector('form [aria-label="Sort by"]')).toBeNull();
    const prices = () =>
      Array.from(root.querySelectorAll('[data-testid="offer"] .price strong')).map((p) =>
        p.textContent?.trim(),
      );
    const first = prices()[0];
    sort.querySelector<HTMLInputElement>('input[value="leaveDays"]')!.click();
    await fixture.whenStable();
    httpTesting.expectNone('/api/search');
    expect(prices()[0]).not.toBe(first);
    expect(JSON.parse(localStorage.getItem('gocitybreak.searchSettings.v1')!).sort).toBe(
      'leaveDays',
    );
  });
});
