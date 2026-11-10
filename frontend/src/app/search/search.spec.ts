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
    expect(offer).toContain('2026-12-05');
    expect(offer).toContain('09:00 – 10:50');
    expect(offer).toContain('≈ 84.98 PLN');
    expect(offer).toContain('19.99 EUR');
    expect(offer).toContain('per person, no cabin bag');
    expect(offer).toContain('price checked 3 h ago');
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
