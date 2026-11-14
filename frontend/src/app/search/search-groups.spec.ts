import { useSearchClock } from './search-testing';
import { fillPlace } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Catalogue, Offer } from './search-api';

/** Offers grouped by destination airport, through the search DOM and HTTP boundary (#61). */
useSearchClock();

/** Milan covers two airports, so a search to Milan finds two destination groups. */
const catalogue: Catalogue = {
  supportedAirports: [{ code: 'KRK', name: 'Kraków' }],
  airports: [
    { code: 'KRK', name: 'Krakow', cities: ['KRAKOW'], country: 'pl' },
    {
      code: 'BGY',
      name: 'Milan Bergamo',
      names: { en: 'Milan Bergamo', pl: 'Mediolan-Bergamo' },
      cities: ['BERGAMO', 'MILAN'],
      country: 'it',
    },
    {
      code: 'MXP',
      name: 'Milan Malpensa',
      names: { en: 'Milan Malpensa', pl: 'Mediolan-Malpensa' },
      cities: ['MILAN'],
      country: 'it',
    },
    {
      code: 'BUD',
      name: 'Budapest',
      names: { en: 'Budapest', pl: 'Budapeszt' },
      cities: ['BUDAPEST'],
      country: 'hu',
    },
  ],
  cities: [
    { code: 'KRAKOW', name: 'Krakow', airports: ['KRK'], country: 'pl' },
    { code: 'BERGAMO', name: 'Bergamo', airports: ['BGY'], country: 'it' },
    {
      code: 'MILAN',
      name: 'Milan',
      names: { en: 'Milan', pl: 'Mediolan' },
      airports: ['BGY', 'MXP'],
      country: 'it',
    },
    { code: 'BUDAPEST', name: 'Budapest', airports: ['BUD'], country: 'hu' },
  ],
  countries: [
    { code: 'pl', name: 'Poland', names: { en: 'Poland', pl: 'Polska' } },
    { code: 'it', name: 'Italy', names: { en: 'Italy', pl: 'Włochy' } },
    { code: 'hu', name: 'Hungary', names: { en: 'Hungary', pl: 'Węgry' } },
  ],
};

/** A round trip from Kraków to `to`, leaving on `day` of December 2026 for two nights. */
function offer(to: string, price: number, day: number, leaveDays = 1): Offer {
  const fetchedAt = new Date().toISOString();
  const date = (d: number) => `2026-12-${String(d).padStart(2, '0')}`;
  const flight = (from: string, into: string, d: number) => ({
    departureAirport: from,
    arrivalAirport: into,
    departure: { date: date(d), time: '10:00', timeZone: 'Europe/Warsaw' },
    arrival: { date: date(d), time: '12:00', timeZone: 'Europe/Rome' },
    originalPrice: { amount: price / 2, currency: 'PLN' },
    fetchedAt,
  });
  return {
    kind: 'roundTrip',
    outbound: { isDirect: true, flights: [flight('KRK', to, day)] },
    inbound: { isDirect: true, flights: [flight(to, 'KRK', day + 2)] },
    nights: 2,
    price: { amount: price, currency: 'PLN', approximate: false },
    priceFetchedAt: fetchedAt,
    leaveDays,
  };
}

/** `count` offers to `to` from `price` up, a day apart from 1 December. */
function offersTo(to: string, count: number, price = 100): Offer[] {
  return Array.from({ length: count }, (_, i) => offer(to, price + i, 1 + (i % 25)));
}

describe('Search destination groups', () => {
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

  /** The search page with home airport KRK and the destination typed as `destination`. */
  async function renderSearch(destination = 'anywhere') {
    const fixture = TestBed.createComponent(Search);
    http.match('/api/catalogue').forEach((req) => req.flush(catalogue));
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', destination);
    for (const [name, value] of Object.entries({ from: '2026-12-01', to: '2026-12-31' })) {
      const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    const settle = () => fixture.whenStable();
    const search = async (offers: Offer[]) => {
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await settle();
      http.expectOne('/api/search').flush({ offers });
      await settle();
    };
    /** Each group row: the button naming the place, with its best offer. */
    const groups = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('[data-testid="group"] > button'));
    const groupNames = () => groups().map((g) => g.querySelector('.place-name')?.textContent);
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="offer"]'));
    const heading = () => root.querySelector('[data-testid="results"] h2')?.textContent?.trim();
    const button = (text: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('[data-testid="results"] button')).find(
        (b) => b.textContent?.trim() === text,
      );
    return { fixture, root, settle, search, groups, groupNames, rows, heading, button };
  }

  it('groups offers to Anywhere by the airport the outbound leg lands at', async () => {
    const { search, groupNames, rows } = await renderSearch();
    await search([offer('BGY', 100, 4), offer('MXP', 120, 5), offer('BGY', 130, 6)]);

    expect(groupNames()).toEqual(['Milan Bergamo', 'Milan Malpensa']);
    expect(rows()).toHaveLength(0);
  });

  it('groups offers to a city of several airports, one group per airport', async () => {
    const { search, groupNames } = await renderSearch('Milan');
    await search([offer('MXP', 90, 4), offer('BGY', 100, 5)]);

    expect(groupNames()).toEqual(['Milan Malpensa', 'Milan Bergamo']);
  });

  it('groups offers to a country', async () => {
    const { search, groupNames } = await renderSearch('Italy');
    await search([offer('BGY', 100, 4)]);

    expect(groupNames()).toEqual(['Milan Bergamo']);
  });

  it('keeps a flat list of offers for a single destination airport', async () => {
    const { search, groups, rows, heading } = await renderSearch('BUD');
    await search([offer('BUD', 100, 4), offer('BUD', 110, 5)]);

    expect(groups()).toHaveLength(0);
    expect(rows()).toHaveLength(2);
    expect(heading()).toBe('2 offers');
  });
});
