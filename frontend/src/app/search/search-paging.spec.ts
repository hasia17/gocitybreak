import { useSearchClock } from './search-testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Offer } from './search-api';

/** Offer paging through the search DOM and HTTP boundary (#40). */
useSearchClock();

describe('Search offer paging', () => {
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

  async function renderSearch() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    for (const [name, value] of Object.entries({
      homeAirports: 'KRK',
      // A single destination airport keeps the flat list of offers this spec pages through.
      destination: 'BGY',
      from: '2026-12-01',
      to: '2026-12-10',
    })) {
      const labels: Record<string, string> = { homeAirports: 'From', destination: 'To' };
      if (labels[name] && fillPlace(root, labels[name], value)) continue;
      const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    const search = () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="offer"]'));
    const more = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('[data-testid="results"] button')).find(
        (b) => ['Show more', 'Pokaż więcej'].includes(b.textContent?.trim() ?? ''),
      ) ?? null;
    return { fixture, root, search, rows, more };
  }

  function offers(count: number): Offer[] {
    const fetchedAt = new Date().toISOString();
    return Array.from({ length: count }, (_, index) => {
      const flight = {
        airline: 'ryanair' as const,
        departureAirport: 'KRK',
        arrivalAirport: 'BGY',
        departure: { date: '2026-12-04', time: '10:00', timeZone: 'Europe/Warsaw' },
        arrival: { date: '2026-12-04', time: '12:00', timeZone: 'Europe/Rome' },
        originalPrice: { amount: 100 + index, currency: 'PLN' },
        fetchedAt,
      };
      return {
        kind: 'roundTrip',
        outbound: { isDirect: true, flights: [flight] },
        inbound: {
          isDirect: true,
          flights: [{ ...flight, departureAirport: 'BGY', arrivalAirport: 'KRK' }],
        },
        nights: 2,
        price: { amount: 100 + index, currency: 'PLN', approximate: false },
        priceFetchedAt: fetchedAt,
        leaveDays: count - index,
      };
    });
  }

  it('shows 20 offers at a time, preserving the total until the last offer is shown', async () => {
    const { fixture, root, search, rows, more } = await renderSearch();
    search();
    http.expectOne('/api/search').flush({ offers: offers(45) });
    await fixture.whenStable();

    expect(rows()).toHaveLength(20);
    expect(root.querySelector('h2')?.textContent).toBe('45 offers');
    expect(more()?.textContent?.trim()).toBe('Show more');
    const firstPage = rows();

    more()!.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(40);
    expect(rows().slice(0, 20)).toEqual(firstPage);
    expect(root.querySelector('h2')?.textContent).toBe('45 offers');

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(rows()).toHaveLength(40);
    expect(more()?.textContent?.trim()).toBe('Pokaż więcej');
    expect(root.querySelector('h2')?.textContent).toBe('45 ofert');

    more()!.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(45);
    expect(more()).toBeNull();
    http.expectNone('/api/search');
  });

  it('starts again from 20 on every new search after revealing more offers', async () => {
    const { fixture, root, search, rows, more } = await renderSearch();
    for (const count of [45, 42, 22]) {
      search();
      http.expectOne('/api/search').flush({ offers: offers(count) });
      await fixture.whenStable();

      expect(rows()).toHaveLength(20);
      expect(root.querySelector('h2')?.textContent).toBe(`${count} offers`);

      more()!.click();
      await fixture.whenStable();
      expect(rows()).toHaveLength(Math.min(40, count));
    }
  });

  it('shows the first 20 of the new sort immediately without another search', async () => {
    const { fixture, root, search, rows, more } = await renderSearch();
    search();
    http.expectOne('/api/search').flush({ offers: offers(45) });
    await fixture.whenStable();
    more()!.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(40);

    root
      .querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="leaveDays"]')!
      .click();
    await fixture.whenStable();

    expect(rows()).toHaveLength(20);
    expect(rows()[0].querySelector('strong')?.textContent).toBe('PLN 144');
    expect(rows()[19].querySelector('strong')?.textContent).toBe('PLN 125');
    expect(root.querySelector('h2')?.textContent).toBe('45 offers');
    more()!.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(40);
    expect(rows()[39].querySelector('strong')?.textContent).toBe('PLN 105');

    root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="price"]')!.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(20);
    expect(rows()[0].querySelector('strong')?.textContent).toBe('PLN 100');
    expect(rows()[19].querySelector('strong')?.textContent).toBe('PLN 119');
    http.expectNone('/api/search');
  });
});
