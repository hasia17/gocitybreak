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

  it('searches one-way offers and lists them with price, times and price age', async () => {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

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
