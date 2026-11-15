import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { flushCatalogue } from './place-testing';

useSearchClock();

describe('Search explanations', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        homeAirports: 'KRK',
        destination: 'BGY',
        from: '2026-12-01',
        to: '2026-12-10',
      }),
    );
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

  function explanation(root: HTMLElement, name: string) {
    const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(button, name).not.toBeNull();
    expect(button!.closest('label'), 'tooltip buttons must not activate a field label').toBeNull();
    const tip = document.getElementById(button!.getAttribute('aria-describedby')!);
    expect(tip?.getAttribute('role')).toBe('tooltip');
    return { button: button!, tip: tip! };
  }

  it('explains date modes, hotel nights, local hours and leave rules next to the fields in both languages', async () => {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('button[aria-controls="filters-panel"]')!.click();
    await fixture.whenStable();

    for (const [name, rule] of [
      ['About flexible dates', /travel window.*nights/i],
      ['About fixed dates', /exact local departure dates/i],
      ['About nights', /hotel nights.*before 06:00.*night before/i],
      ['About work start', /after work end.*before work start.*no leave day/i],
      ['About work end', /after work end.*before work start.*no leave day/i],
      ['About max leave days', /working days.*weekends.*Polish public holidays/i],
      ['About outbound departure time', /local time.*each airport.*ticket/i],
      ['About outbound arrival time', /local time.*each airport.*ticket/i],
      ['About inbound departure time', /local time.*each airport.*ticket/i],
      ['About inbound arrival time', /local time.*each airport.*ticket/i],
    ] as const) {
      expect(explanation(root, name).tip.textContent).toMatch(rule);
    }
    explanation(root, 'About fixed dates').button.click();
    await fixture.whenStable();
    expect(root.querySelector<HTMLInputElement>('input[value="flexible"]')!.checked).toBe(true);

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    for (const [name, rule] of [
      ['O elastycznych datach', /oknie podróży.*nocy/i],
      ['O stałych datach', /dokładne lokalne daty wylotu/i],
      ['O nocach', /hotelowe.*przed 06:00.*poprzedniej nocy/i],
      ['O początku pracy', /po końcu pracy.*przed początkiem pracy.*dnia urlopu/i],
      ['O końcu pracy', /po końcu pracy.*przed początkiem pracy.*dnia urlopu/i],
      ['O maksymalnej liczbie dni urlopu', /dni robocze.*weekendów.*polskich świąt/i],
      ['O godzinie wylotu tam', /czas lokalny.*każdym lotnisku.*bilecie/i],
      ['O godzinie przylotu tam', /czas lokalny.*każdym lotnisku.*bilecie/i],
      ['O godzinie wylotu z powrotem', /czas lokalny.*każdym lotnisku.*bilecie/i],
      ['O godzinie przylotu z powrotem', /czas lokalny.*każdym lotnisku.*bilecie/i],
    ] as const) {
      expect(explanation(root, name).tip.textContent).toMatch(rule);
    }
  });
  it('explains approximate PLN prices, stored price age and separate-ticket risk in both languages', async () => {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const flight = (from: string, to: string, currency: string) => ({
      departureAirport: from,
      arrivalAirport: to,
      departure: { date: '2026-12-04', time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date: '2026-12-04', time: '12:00', timeZone: 'Europe/London' },
      originalPrice: { amount: 30, currency },
      fetchedAt: '2026-11-12T12:00:00Z',
    });
    http.expectOne('/api/search').flush({
      offers: [
        {
          kind: 'oneWay',
          outbound: {
            isDirect: false,
            flights: [flight('KRK', 'STN', 'PLN'), flight('STN', 'BGY', 'GBP')],
          },
          price: { amount: 180, currency: 'PLN', approximate: true },
          priceFetchedAt: '2026-11-12T12:00:00Z',
        },
        {
          kind: 'oneWay',
          outbound: { isDirect: true, flights: [flight('KRK', 'BGY', 'PLN')] },
          price: { amount: 100, currency: 'PLN', approximate: false },
          priceFetchedAt: '2026-11-12T12:00:00Z',
        },
      ],
    });
    await fixture.whenStable();
    const offers = root.querySelectorAll<HTMLElement>('[data-testid="offer"]');
    const approximate = Array.from(offers).find((o) => /PLN\s180/.test(o.textContent!))!;
    expect(approximate.querySelectorAll('app-info-tip')).toHaveLength(1);
    const info = explanation(approximate, 'About this price').tip.textContent!;
    expect(info).toMatch(/PLN.*NBP mid-market rate.*another currency/i);
    expect(info).toMatch(/stored price.*may have changed.*Ryanair/i);
    expect(info).toMatch(/self-transfer.*own risk.*next flight.*late/i);
    const direct = Array.from(offers).find((o) => /PLN\s100/.test(o.textContent!))!;
    expect(direct.querySelectorAll('app-info-tip')).toHaveLength(1);
    const directInfo = explanation(direct, 'About this price').tip.textContent!;
    expect(directInfo).toContain('Ryanair');
    expect(directInfo).not.toContain('NBP');
    expect(directInfo).not.toContain('self-transfer');

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    const polish = explanation(approximate, 'O tej cenie').tip.textContent!;
    expect(polish).toMatch(/PLN.*średnim kursie NBP.*innej walucie/i);
    expect(polish).toMatch(/zapisana cena.*zmienić.*Ryanair/i);
    expect(polish).toMatch(/przesiadka.*własne ryzyko.*kolejnego lotu.*spóźni/i);
  });
});
