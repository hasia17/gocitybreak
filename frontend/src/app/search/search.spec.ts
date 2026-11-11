import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Search } from './search';

describe('Search', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

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

  /** Ticks a weekday checkbox, e.g. "Fri" among the "Departure days". */
  function day(root: HTMLElement, days: string, weekday: string) {
    const fieldset = Array.from(root.querySelectorAll('fieldset')).find(
      (f) => f.querySelector('legend')?.textContent?.trim() === days,
    );
    const box = Array.from(fieldset?.querySelectorAll('label') ?? [])
      .find((l) => l.textContent?.trim() === weekday)
      ?.querySelector('input');
    if (!box) throw new Error(`no ${weekday} among ${days}`);
    box.click();
  }

  function nights(root: HTMLElement, which: 'Minimum' | 'Maximum') {
    return root.querySelector<HTMLInputElement>(`input[aria-label="${which} nights"]`);
  }

  it('searches round-trip offers from several home airports by default and lists both legs with nights', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'krk, KTW');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    const max = nights(root, 'Maximum')!;
    max.value = '4';
    max.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual({
      kind: 'roundTrip',
      homeAirports: ['KRK', 'KTW'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      stayLength: { min: 2, max: 4 },
    });
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
    expect(offer).toContain('≈ 173.98 PLN');
    expect(offer).toContain('19.99 EUR');
    expect(offer).not.toContain('89.00 PLN ·');
  });

  it('sends the chosen time ranges, weekdays, direct only and price-per-night sort', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    labelled<HTMLInputElement>(root, 'Direct flights only').click();
    time(root, 'Outbound departure from', '06:00');
    time(root, 'Outbound departure to', '12:00');
    // An open-ended range runs to the end of the day, or from its start.
    time(root, 'Inbound arrival to', '22:00');
    time(root, 'Outbound arrival from', '09:00');
    day(root, 'Departure days', 'Thu');
    day(root, 'Departure days', 'Fri');
    day(root, 'Return days', 'Sun');
    const sort = labelled<HTMLSelectElement>(root, 'Sort by');
    sort.value = 'pricePerNight';
    sort.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual({
      kind: 'roundTrip',
      homeAirports: ['KRK'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      stayLength: { min: 2, max: 3 },
      filters: {
        directOnly: true,
        outboundDeparture: { from: '06:00', to: '12:00' },
        outboundArrival: { from: '09:00', to: '23:59' },
        inboundArrival: { from: '00:00', to: '22:00' },
        departureWeekdays: ['thu', 'fri'],
        returnWeekdays: ['sun'],
      },
      sort: 'pricePerNight',
    });
    req.flush({ offers: [] });
  });

  it('offers only outbound filters and price sorting for one-way offers', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    time(root, 'Inbound departure from', '14:00');
    day(root, 'Return days', 'Sun');
    const sort = labelled<HTMLSelectElement>(root, 'Sort by');
    sort.value = 'pricePerNight';
    sort.dispatchEvent(new Event('change'));
    root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    await fixture.whenStable();

    expect(root.querySelector('input[aria-label="Inbound departure from"]')).toBeNull();
    expect(root.textContent).not.toContain('Return days');
    expect(root.querySelector('option[value="pricePerNight"]')).toBeNull();
    time(root, 'Outbound arrival to', '10:00');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual({
      kind: 'oneWay',
      homeAirports: ['KRK'],
      destination: { airports: ['BGY'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
      filters: { outboundArrival: { from: '00:00', to: '10:00' } },
    });
    req.flush({ offers: [] });
  });

  it('shows the price per night of a round-trip offer', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const fetchedAt = new Date().toISOString();
    const flight = (from: string, to: string, date: string) => ({
      departureAirport: from,
      arrivalAirport: to,
      departure: { date, time: '18:00', timeZone: 'Europe/Warsaw' },
      arrival: { date, time: '19:55', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 50, currency: 'PLN' },
      fetchedAt,
    });
    httpTesting.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'roundTrip',
          outbound: { isDirect: true, flights: [flight('KRK', 'BGY', '2026-12-04')] },
          inbound: { isDirect: true, flights: [flight('BGY', 'KRK', '2026-12-07')] },
          nights: 3,
          price: { amount: 90.99, currency: 'PLN', approximate: true },
          pricePerNight: { amount: 30.33, currency: 'PLN', approximate: true },
          priceFetchedAt: fetchedAt,
        },
      ],
    });
    await fixture.whenStable();

    const offer = root.querySelector('[data-testid="offer"]')?.textContent?.replace(/\s+/g, ' ');
    expect(offer).toContain('≈ 30.33 PLN per night');
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

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual({
      kind: 'oneWay',
      homeAirports: ['BGY'],
      destination: { airports: ['KRK'] },
      travelWindow: { from: '2026-12-01', to: '2026-12-10' },
    });
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    req.flush({
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
    expect(offer).toContain('≈ 84.98 PLN');
    expect(offer).toContain('19.99 EUR');
    expect(offer).toContain('checked 3 h ago');
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
});
