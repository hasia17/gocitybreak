import { provideTestI18n } from '../i18n/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Search } from './search';
import { TranslocoService } from '@jsverse/transloco';
import { Catalogue } from './search-api';

const catalogue: Catalogue = {
  supportedAirports: [{ code: 'KRK', name: 'Kraków', names: { en: 'Krakow', pl: 'Kraków' } }],
  airports: [
    {
      code: 'BGY',
      name: 'Milan Bergamo',
      names: { en: 'Milan Bergamo', pl: 'Mediolan-Bergamo' },
      cities: ['BERGAMO', 'MILAN'],
      country: 'it',
    },
    { code: 'KRK', name: 'Kraków', cities: ['KRAKOW'], country: 'pl' },
    { code: 'MXP', name: 'Milan Malpensa', cities: ['MILAN'], country: 'it' },
    { code: 'OSL', name: 'Oslo', cities: ['OSLO'], country: 'no' },
  ],
  cities: [
    { code: 'BERGAMO', name: 'Bergamo', country: 'it', airports: ['BGY'] },
    { code: 'KRAKOW', name: 'Kraków', country: 'pl', airports: ['KRK'] },
    {
      code: 'MILAN',
      name: 'Milan',
      names: { en: 'Milan', pl: 'Mediolan' },
      country: 'it',
      airports: ['BGY', 'MXP'],
    },
    { code: 'OSLO', name: 'Oslo', country: 'no', airports: ['OSL'] },
  ],
  countries: [
    { code: 'it', name: 'Italy' },
    { code: 'no', name: 'Norway' },
    { code: 'pl', name: 'Poland' },
    { code: 'es', name: 'Spain', names: { en: 'Spain', pl: 'Hiszpania' } },
  ],
};

describe('Search', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear(); // search remembers its settings; each test starts from the defaults
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Tests that type only airport codes leave the catalogue request unanswered.
    httpTesting.match('/api/catalogue');
    httpTesting.verify();
  });

  function fill(root: HTMLElement, label: string, value: string) {
    const input = Array.from(root.querySelectorAll('label'))
      .find((l) => l.textContent?.trim().startsWith(label))
      ?.querySelector('input');
    if (!input) throw new Error(`no input labelled ${label}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function labelled<T extends Element>(root: HTMLElement, name: string): T {
    const el = Array.from(root.querySelectorAll<T>('input, select')).find(
      (e) =>
        e.getAttribute('aria-label') === name || e.closest('label')?.textContent?.trim() === name,
    );
    if (!el) throw new Error(`no control labelled ${name}`);
    return el;
  }

  function time(root: HTMLElement, name: string, value: string) {
    const input = labelled<HTMLInputElement>(root, name);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** The checkbox of a weekday, e.g. "Fri" among the "Outbound departure days". */
  function dayBox(root: HTMLElement, days: string, weekday: string): HTMLInputElement {
    const fieldset = Array.from(root.querySelectorAll('fieldset')).find((f) =>
      f.querySelector('legend')?.textContent?.trim().startsWith(days),
    );
    const box = Array.from(fieldset?.querySelectorAll('label') ?? [])
      .find((l) => l.textContent?.trim() === weekday)
      ?.querySelector('input');
    if (!box) throw new Error(`no ${weekday} among ${days}`);
    return box;
  }

  /** Ticks or unticks a weekday checkbox. */
  function day(root: HTMLElement, days: string, weekday: string) {
    dayBox(root, days, weekday).click();
  }

  function nights(root: HTMLElement, which: 'Minimum' | 'Maximum') {
    return root.querySelector<HTMLInputElement>(`input[aria-label="${which} nights"]`);
  }

  it('lists both legs of a round-trip offer with its nights', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/search' });
    const fetchedAt = new Date().toISOString();
    req.flush({
      offers: [
        {
          kind: 'roundTrip',
          outbound: {
            isDirect: true,
            flights: [
              {
                departureAirport: 'KRK',
                arrivalAirport: 'BGY',
                departure: { date: '2026-12-04', time: '18:00', timeZone: 'Europe/Warsaw' },
                arrival: { date: '2026-12-04', time: '19:55', timeZone: 'Europe/Rome' },
                originalPrice: { amount: 89, currency: 'PLN' },
                fetchedAt,
              },
            ],
          },
          inbound: {
            isDirect: true,
            flights: [
              {
                departureAirport: 'BGY',
                arrivalAirport: 'KTW',
                departure: { date: '2026-12-06', time: '20:00', timeZone: 'Europe/Rome' },
                arrival: { date: '2026-12-06', time: '21:50', timeZone: 'Europe/Warsaw' },
                originalPrice: { amount: 19.99, currency: 'EUR' },
                fetchedAt,
              },
            ],
          },
          nights: 2,
          price: { amount: 173.98, currency: 'PLN', approximate: true },
          priceFetchedAt: fetchedAt,
        },
      ],
    });
    await fixture.whenStable();

    const offer = root.querySelector('[data-testid="offer"]')?.textContent?.replace(/\s+/g, ' ');
    expect(offer).toMatch(/Fri 4 Dec 18:00 – 19:55 KRK → BGY.*Sun 6 Dec 20:00 – 21:50 BGY → KTW/);
    expect(offer).toContain('2 nights');
    expect(offer).toContain('≈ PLN 173.98');
    expect(offer).toContain('€19.99');
    expect(offer).not.toContain('89.00 PLN ·');
  });

  it('remembers work hours, the maximum of leave days and the sort for the next visit', async () => {
    const first = TestBed.createComponent(Search);
    await first.whenStable();
    let root = first.nativeElement as HTMLElement;
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    fill(root, 'Work start', '07:30');
    fill(root, 'Work end', '15:30');
    fill(root, 'Max leave days', '1');
    root
      .querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="leaveDays"]')!
      .click();
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    first.destroy();

    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;

    const value = (label: string) =>
      Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input')?.value;
    expect(value('Work start')).toBe('07:30');
    expect(value('Work end')).toBe('15:30');
    expect(value('Max leave days')).toBe('1');
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input:checked')!.value,
    ).toBe('leaveDays');
  });

  it('remembers the round-trip settings through a one-way search', async () => {
    const first = TestBed.createComponent(Search);
    await first.whenStable();
    let root = first.nativeElement as HTMLElement;
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    fill(root, 'Work start', '07:30');
    fill(root, 'Work end', '15:30');
    fill(root, 'Max leave days', '1');
    root
      .querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="leaveDays"]')!
      .click();
    root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    await first.whenStable();
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    first.destroy();

    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.checked).toBe(true);

    // The fields a one-way search does not use keep their values for the next round trip.
    root.querySelector<HTMLInputElement>('input[type="radio"][value="roundTrip"]')!.click();
    await fixture.whenStable();
    const value = (label: string) =>
      Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input')?.value;
    expect(value('Work start')).toBe('07:30');
    expect(value('Work end')).toBe('15:30');
    expect(value('Max leave days')).toBe('1');
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input:checked')!.value,
    ).toBe('leaveDays');
  });

  it('offers only outbound filters and price sorting for one-way offers', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    // Half a range is invalid, but inbound filters do not apply to one-way offers.
    time(root, 'Inbound departure from', '14:00');
    day(root, 'Inbound departure days', 'Sun');
    root
      .querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="leaveDays"]')!
      .click();
    root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    await fixture.whenStable();

    expect(root.querySelector('input[aria-label="Inbound departure from"]')).toBeNull();
    expect(root.textContent).not.toContain('Inbound departure days');
    expect(root.querySelector('input[value="leaveDays"]')).toBeNull();
    time(root, 'Outbound arrival from', '06:00');
    time(root, 'Outbound arrival to', '10:00');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    httpTesting.expectOne('/api/search').flush({ offers: [] });
  });

  it('marks a time range with only one end set invalid instead of searching', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    time(root, 'Inbound arrival to', '22:00');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    httpTesting.expectNone('/api/search');
    expect(
      labelled<HTMLInputElement>(root, 'Inbound arrival from').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('both ends');
  });

  it('remembers the filters for the next visit', async () => {
    const first = TestBed.createComponent(Search);
    await first.whenStable();
    let root = first.nativeElement as HTMLElement;
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    time(root, 'Outbound departure from', '06:00');
    time(root, 'Outbound departure to', '12:00');
    day(root, 'Outbound departure days', 'Fri');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    first.destroy();

    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;

    expect(labelled<HTMLInputElement>(root, 'Outbound departure from').value).toBe('06:00');
    expect(dayBox(root, 'Outbound departure days', 'Fri').checked).toBe(false);
    expect(dayBox(root, 'Outbound departure days', 'Thu').checked).toBe(true);
  });

  it('ticks every departure day by default and greys out the days outside the travel window, live', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const all = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const enabled = (days: string) => all.filter((d) => !dayBox(root, days, d).disabled);

    expect(all.every((d) => dayBox(root, 'Outbound departure days', d).checked)).toBe(true);
    expect(root.querySelector('legend [aria-label="About departure days"]')).not.toBeNull();
    expect(enabled('Outbound departure days')).toEqual(all);

    // Wed 11 Nov 2026 – Fri 13 Nov 2026
    fill(root, 'Earliest', '2026-11-11');
    fill(root, 'Latest', '2026-11-13');
    await fixture.whenStable();
    expect(enabled('Outbound departure days')).toEqual(['Wed', 'Thu', 'Fri']);
    expect(enabled('Inbound departure days')).toEqual(['Wed', 'Thu', 'Fri']);
    // A greyed-out day keeps its tick for when the window covers it again.
    expect(dayBox(root, 'Outbound departure days', 'Mon').checked).toBe(true);

    fill(root, 'Latest', '2026-11-20');
    await fixture.whenStable();
    expect(enabled('Outbound departure days')).toEqual(all);
  });

  it('asks to leave a departure day ticked instead of searching when no possible day is', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-11-11');
    fill(root, 'Latest', '2026-11-13');
    await fixture.whenStable();
    for (const d of ['Wed', 'Thu', 'Fri']) day(root, 'Inbound departure days', d);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    httpTesting.expectNone('/api/search');
    const alert = root.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain('leave at least one departure day ticked');
    expect(alert).not.toContain('3-letter airport codes');
    const inbound = Array.from(root.querySelectorAll('fieldset')).find((f) =>
      f.querySelector('legend')?.textContent?.trim().startsWith('Inbound departure days'),
    );
    expect(inbound?.classList).toContain('invalid');

    // A one-way search has no inbound flight, so the inbound days do not block it.
    root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(httpTesting.expectOne('/api/search').request.body.filters).toBeUndefined();
  });

  it('marks the nights invalid when the maximum is below the minimum', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    const max = nights(root, 'Maximum')!;
    max.value = '1';
    max.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    httpTesting.expectNone('/api/search');
    expect(nights(root, 'Maximum')!.closest('.field')?.classList).toContain('invalid');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('nights');
  });

  it('searches one-way offers and lists them with price, times and price age', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    await fixture.whenStable();
    expect(nights(root, 'Minimum')).toBeNull();
    fill(root, 'From', 'bgy');
    fill(root, 'To', 'KRK');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    httpTesting.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'oneWay',
          outbound: {
            isDirect: true,
            flights: [
              {
                departureAirport: 'BGY',
                arrivalAirport: 'KRK',
                departure: { date: '2026-12-05', time: '09:00', timeZone: 'Europe/Rome' },
                arrival: { date: '2026-12-05', time: '10:50', timeZone: 'Europe/Warsaw' },
                originalPrice: { amount: 19.99, currency: 'EUR' },
                fetchedAt: threeHoursAgo,
              },
            ],
          },
          price: { amount: 84.98, currency: 'PLN', approximate: true },
          priceFetchedAt: threeHoursAgo,
        },
      ],
    });
    await fixture.whenStable();

    const offer = root.querySelector('[data-testid="offer"]')?.textContent?.replace(/\s+/g, ' ');
    expect(offer).toContain('BGY → KRK');
    expect(offer).toContain('Sat 5 Dec');
    expect(offer).not.toContain('2026');
    expect(offer).toContain('09:00 – 10:50');
    expect(root.querySelector('[data-testid="offer"] abbr')).toBeNull();
    expect(offer).toContain('≈ PLN 84.98');
    expect(offer).toContain('€19.99');
    expect(offer).toContain('checked 3 hr ago');
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse(threeHoursAgo) + 4 * 60 * 60 * 1000);
    try {
      fill(root, 'To', 'KRK');
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain(
        'checked 4 hr ago',
      );
    } finally {
      clock.mockRestore();
    }
    expect(offer).not.toContain('stop');
    expect(root.querySelector('[data-testid="results"]')?.textContent).toContain(
      'per person, no cabin bag',
    );
  });

  it('marks the invalid fields themselves when the form is submitted incomplete', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BG');
    root.querySelectorAll('input').forEach((i) => i.dispatchEvent(new Event('blur')));
    await fixture.whenStable();
    expect(root.querySelector('input[aria-invalid="true"]')).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();

    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    const invalid = Array.from(root.querySelectorAll('input[aria-invalid="true"]')).map(
      (i) => i.closest('label')?.textContent?.trim().split(/\s/)[0],
    );
    expect(invalid).toEqual(['To', 'Earliest', 'Latest']);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('3-letter airport codes');
  });

  it('shows the year only for dates outside the current year, and stops only for indirect legs', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const nextYear = new Date().getFullYear() + 1;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', `${nextYear}-01-01`);
    fill(root, 'Latest', `${nextYear}-01-10`);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const fetchedAt = new Date().toISOString();
    const flight = (from: string, to: string, time: string) => ({
      departureAirport: from,
      arrivalAirport: to,
      departure: { date: `${nextYear}-01-02`, time, timeZone: 'Europe/Warsaw' },
      arrival: { date: `${nextYear}-01-02`, time, timeZone: 'Europe/Warsaw' },
      originalPrice: { amount: 50, currency: 'PLN' },
      fetchedAt,
    });
    httpTesting.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'oneWay',
          outbound: {
            isDirect: false,
            flights: [flight('KRK', 'STN', '06:00'), flight('STN', 'BGY', '12:00')],
          },
          price: { amount: 100, currency: 'PLN', approximate: false },
          priceFetchedAt: fetchedAt,
        },
      ],
    });
    await fixture.whenStable();

    const offer = root.querySelector('[data-testid="offer"]')?.textContent?.replace(/\s+/g, ' ');
    expect(offer).toContain(`2 Jan ${nextYear}`);
    expect(offer).toContain('1 stop');
  });

  it('marks a flight that lands on a later day than it departs', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-31');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const fetchedAt = new Date().toISOString();
    httpTesting.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'oneWay',
          outbound: {
            isDirect: true,
            flights: [
              {
                departureAirport: 'KRK',
                arrivalAirport: 'BGY',
                departure: { date: '2026-12-10', time: '23:30', timeZone: 'Europe/Warsaw' },
                arrival: { date: '2026-12-11', time: '01:20', timeZone: 'Europe/Rome' },
                originalPrice: { amount: 50, currency: 'PLN' },
                fetchedAt,
              },
            ],
          },
          price: { amount: 50, currency: 'PLN', approximate: false },
          priceFetchedAt: fetchedAt,
        },
      ],
    });
    await fixture.whenStable();

    const offer = root.querySelector('[data-testid="offer"]')!;
    expect(offer.textContent?.replace(/\s+/g, ' ')).toContain('23:30 – 01:20 +1');
    expect(offer.querySelector('abbr')?.getAttribute('title')).toBe('arrives 2026-12-11');
  });

  it('says so when no offer matches', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();

    expect(root.textContent).toContain('No offers');
  });

  it('takes only supported airports as home airports, and lists them when another is typed', async () => {
    const fixture = TestBed.createComponent(Search);
    httpTesting.expectOne({ method: 'GET', url: '/api/catalogue' }).flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK, BGY');
    fill(root, 'To', 'Oslo');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    httpTesting.expectNone('/api/search');
    expect(labelled<HTMLInputElement>(root, 'From').getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('KRK (Krakow)');
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('KRK (Kraków)');
  });

  describe('destination', () => {
    async function searchFrom(destination: string, exclusions = '') {
      const fixture = TestBed.createComponent(Search);
      httpTesting.expectOne({ method: 'GET', url: '/api/catalogue' }).flush(catalogue);
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
      fill(root, 'From', 'KRK');
      fill(root, 'To', destination);
      fill(root, 'Except', exclusions);
      fill(root, 'Earliest', '2026-12-01');
      fill(root, 'Latest', '2026-12-10');
      root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await fixture.whenStable();
      return root;
    }

    it.each([
      ['Milan', { cities: ['MILAN'] }],
      ['Mediolan', { cities: ['MILAN'] }],
      ['Spain', { countries: ['es'] }],
      ['Hiszpania', { countries: ['es'] }],
      ['Milan Bergamo', { airports: ['BGY'] }],
      ['Mediolan-Bergamo', { airports: ['BGY'] }],
    ])('resolves %s from either catalogue language', async (name, destination) => {
      await searchFrom(name as string);
      const req = httpTesting.expectOne('/api/search');
      expect(req.request.body.destination).toEqual(destination);
      req.flush({ offers: [] });
    });

    it('marks an airport, city or country it does not know', async () => {
      const root = await searchFrom('Milan, Atlantis', 'anywhere');

      httpTesting.expectNone('/api/search');
      const invalid = Array.from(root.querySelectorAll('input[aria-invalid="true"]')).map(
        (i) => i.closest('label')?.textContent?.trim().split(/\s/)[0],
      );
      expect(invalid).toEqual(['To', 'Except']);
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('cities or countries');
    });
  });
});
