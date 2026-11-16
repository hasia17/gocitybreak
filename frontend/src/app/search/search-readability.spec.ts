import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Catalogue, Flight } from './search-api';
import { fillPlace } from './place-testing';

useSearchClock();

describe('Search offer readability', () => {
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
    http.verify();
    localStorage.clear();
  });

  it('labels each leg and names all self-transfer airports, updating language without another request', async () => {
    const fixture = TestBed.createComponent(Search);
    const catalogue: Catalogue = {
      supportedAirports: [{ code: 'KRK', name: 'Krakow' }],
      airports: [
        { code: 'KRK', name: 'Krakow Airport', cities: ['KRAKOW'] },
        { code: 'STN', name: 'London Stansted', cities: ['LONDON'] },
        { code: 'BGY', name: 'Milan Bergamo', cities: ['BERGAMO', 'MILAN'] },
      ],
      cities: [
        { code: 'KRAKOW', name: 'Krakow', names: { pl: 'Kraków' }, airports: ['KRK'] },
        { code: 'LONDON', name: 'London', names: { pl: 'Londyn' }, airports: ['STN'] },
        { code: 'MILAN', name: 'Milan', names: { pl: 'Mediolan' }, airports: ['BGY'] },
        { code: 'BERGAMO', name: 'Bergamo', airports: ['BGY'] },
      ],
      countries: [],
    };
    http.expectOne('/api/catalogue').flush(catalogue);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    for (const [label, value] of [
      ['From', 'KRK'],
      ['To', 'BGY'],
      ['Earliest', '2026-12-01'],
      ['Latest', '2026-12-10'],
    ]) {
      if (fillPlace(root, label, value)) continue;
      const input = Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))!
        .querySelector('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const fetchedAt = new Date().toISOString();
    const flight = (from: string, to: string, date: string): Flight => ({
      airline: 'ryanair' as const,
      departureAirport: from,
      arrivalAirport: to,
      departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 100, currency: 'PLN' },
      fetchedAt,
    });
    http.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'roundTrip',
          outbound: {
            isDirect: false,
            flights: [flight('KRK', 'STN', '2026-12-04'), flight('STN', 'BGY', '2026-12-04')],
          },
          inbound: { isDirect: true, flights: [flight('BGY', 'KRK', '2026-12-06')] },
          price: { amount: 300, currency: 'PLN', approximate: false },
          priceFetchedAt: fetchedAt,
          nights: 2,
        },
      ],
    });
    await fixture.whenStable();

    const leg = (label: string) => root.querySelector(`[role="group"][aria-label="${label}"]`);
    const routes = (label: string) =>
      Array.from(leg(label)?.querySelectorAll('.route') ?? []).map((el) => el.textContent?.trim());
    expect(leg('Outbound')?.textContent).toContain('Outbound');
    expect(leg('Return')?.textContent).toContain('Return');
    expect(routes('Outbound')).toEqual(['KRK Krakow → STN London', 'STN London → BGY Bergamo']);
    expect(routes('Return')).toEqual(['BGY Bergamo → KRK Krakow']);

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();

    expect(leg('Wylot')?.textContent).toContain('Wylot');
    expect(leg('Powrót')?.textContent).toContain('Powrót');
    expect(routes('Wylot')).toEqual(['KRK Kraków → STN Londyn', 'STN Londyn → BGY Bergamo']);
    expect(routes('Powrót')).toEqual(['BGY Bergamo → KRK Kraków']);
    http.expectNone('/api/search');
    http.expectNone('/api/catalogue');
  });
});
