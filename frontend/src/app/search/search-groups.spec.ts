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
    /** Text with every run of spaces, the currency's non-breaking ones too, as one plain space. */
    const plain = (text?: string | null) => text?.replace(/\s+/g, ' ').trim();
    const heading = () => plain(root.querySelector('[data-testid="results"] h2')?.textContent);
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

  it('shows each group with its place, best offer and other dates, in English and Polish', async () => {
    const { fixture, search, groups, heading } = await renderSearch();
    await search([
      offer('BGY', 100, 4, 1),
      offer('MXP', 157.5, 11, 0),
      offer('BGY', 130, 5, 2),
      offer('BGY', 140, 6, 2),
    ]);
    const text = () => groups().map((g) => g.textContent!.replace(/\s+/g, ' ').trim());

    expect(heading()).toBe('4 offers in 2 places, from PLN 100');
    expect(text()).toEqual([
      'Milan Bergamo BGY, Italy 2 more dates Fri 4 Dec – Sun 6 Dec 2 nights 1 leave day PLN 100',
      'Milan Malpensa MXP, Italy Fri 11 Dec – Sun 13 Dec 2 nights no leave days PLN 158',
    ]);

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(heading()).toBe('4 oferty w 2 miejscach, od 100 zł');
    expect(text()).toEqual([
      'Mediolan-Bergamo BGY, Włochy jeszcze 2 terminy pt 4 gru – niedz 6 gru 2 noce 1 dzień urlopu 100 zł',
      'Mediolan-Malpensa MXP, Włochy pt 11 gru – niedz 13 gru 2 noce bez urlopu 158 zł',
    ]);
  });

  it('counts offers and places in the heading in Polish plural forms', async () => {
    const { fixture, search, heading } = await renderSearch();
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    await search([offer('BGY', 210, 4)]);

    expect(heading()).toBe('1 oferta w 1 miejscu, od 210 zł');
  });

  it('opens a group on its first 5 offers, shows all on demand and keeps other groups open', async () => {
    const { fixture, settle, search, groups, rows, button } = await renderSearch();
    await search([...offersTo('BGY', 7, 100), ...offersTo('MXP', 3, 200)]);
    const [bergamo, malpensa] = groups();
    const prices = () =>
      rows().map((r) => r.querySelector('.price strong')?.textContent?.replace(/\s+/g, ' '));

    expect(bergamo.getAttribute('aria-expanded')).toBe('false');
    expect(rows()).toHaveLength(0);

    bergamo.click();
    await settle();
    expect(bergamo.getAttribute('aria-expanded')).toBe('true');
    expect(prices()).toEqual(['PLN 100', 'PLN 101', 'PLN 102', 'PLN 103', 'PLN 104']);
    // Inside a group named by its airport, a direct leg does not repeat the destination.
    expect(rows()[0].querySelector('.route')).toBeNull();
    expect(button('Show all 7 dates')).toBeDefined();

    malpensa.click();
    await settle();
    expect(rows()).toHaveLength(8);
    // A group of no more than 5 offers already shows them all.
    expect(button('Show all 3 dates')).toBeUndefined();

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await settle();
    expect(button('Pokaż wszystkie 7 terminów')).toBeDefined();
    button('Pokaż wszystkie 7 terminów')!.click();
    await settle();
    expect(rows()).toHaveLength(10);
    expect(button('Pokaż wszystkie 7 terminów')).toBeUndefined();

    malpensa.click();
    await settle();
    expect(malpensa.getAttribute('aria-expanded')).toBe('false');
    expect(rows()).toHaveLength(7);
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('10 ofert');
  });

  /** One offer to each of `count` airports outside the catalogue, named by their codes. */
  const placesOffers = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      offer(`Z${String(i).padStart(2, '0')}`, 100 + i, 1 + (i % 25), count - i),
    );

  it('shows 20 groups at a time with "Show more places"', async () => {
    const { fixture, settle, search, groups, heading, button } = await renderSearch();
    await search(placesOffers(45));

    expect(groups()).toHaveLength(20);
    expect(heading()).toBe('45 offers in 45 places, from PLN 100');
    button('Show more places')!.click();
    await settle();
    expect(groups()).toHaveLength(40);

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    button('Pokaż więcej miejsc')!.click();
    await settle();
    expect(groups()).toHaveLength(45);
    expect(button('Pokaż więcej miejsc')).toBeUndefined();
  });

  it('starts again from the first 20 groups, all closed, on a new search or sort', async () => {
    const { root, settle, search, groups, groupNames, rows, button } = await renderSearch();
    const openFirst = async () => {
      button('Show more places')!.click();
      groups()[0].click();
      await settle();
      expect(groups()).toHaveLength(40);
      expect(rows()).toHaveLength(1);
    };
    await search(placesOffers(45));
    await openFirst();

    await search(placesOffers(42));
    expect(groups()).toHaveLength(20);
    expect(rows()).toHaveLength(0);
    expect(groups()[0].getAttribute('aria-expanded')).toBe('false');
    await openFirst();

    root
      .querySelector<HTMLInputElement>('[aria-label="Sort by"] input[value="leaveDays"]')!
      .click();
    await settle();
    expect(groups()).toHaveLength(20);
    expect(rows()).toHaveLength(0);
    expect(groupNames()[0]).toBe('Z41');
    http.expectNone('/api/search');
  });

  it('keeps a flat list of offers for a single destination airport', async () => {
    const { search, groups, rows, heading } = await renderSearch('BUD');
    await search([offer('BUD', 100, 4), offer('BUD', 110, 5)]);

    expect(groups()).toHaveLength(0);
    expect(rows()).toHaveLength(2);
    expect(heading()).toBe('2 offers');
  });
});
