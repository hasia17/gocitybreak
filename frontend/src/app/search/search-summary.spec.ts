import { useSearchClock } from './search-testing';
import { flushCatalogue } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';
import { Offer } from './search-api';

/** The summary that replaces the form after a search, through the search DOM and HTTP boundary (#62). */
useSearchClock();

describe('Search summary', () => {
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
    document.body.replaceChildren();
  });

  async function render(settings: object = {}) {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        homeAirports: 'KRK',
        destination: 'anywhere',
        from: '2026-12-20',
        to: '2026-12-31',
        ...settings,
      }),
    );
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    // Focus and sticky positioning need the component in the document.
    document.body.appendChild(root);
    const submit = () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const summary = () => root.querySelector<HTMLElement>('[data-testid="summary"]');
    const text = () => summary()?.textContent?.replace(/\s+/g, ' ').trim();
    const form = () => root.querySelector<HTMLElement>('form')!;
    const visible = (el: HTMLElement) => !el.closest('[hidden]');
    /** Search and answer with `count` offers. */
    const found = async (count = 3) => {
      submit();
      http.expectOne('/api/search').flush({ offers: offers(count) });
      await fixture.whenStable();
    };
    return { fixture, root, submit, summary, text, form, visible, found };
  }

  function offers(count: number): Offer[] {
    const fetchedAt = new Date().toISOString();
    return Array.from({ length: count }, (_, index) => {
      const flight = {
        departureAirport: 'KRK',
        arrivalAirport: 'BGY',
        departure: { date: '2026-12-24', time: '10:00', timeZone: 'Europe/Warsaw' },
        arrival: { date: '2026-12-24', time: '12:00', timeZone: 'Europe/Rome' },
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
        leaveDays: 1,
      } as Offer;
    });
  }

  it('shows no summary before a search', async () => {
    const { summary, form, visible } = await render();
    expect(summary()).toBeNull();
    expect(visible(form())).toBe(true);
  });

  it('replaces the form with the flexible round trip summary, in English and Polish', async () => {
    const { fixture, text, form, visible, found } = await render();
    await found();

    expect(visible(form())).toBe(false);
    expect(text()).toContain('Kraków → Anywhere');
    expect(text()).toContain('20 Dec – 31 Dec');
    expect(text()).toContain('2–3 nights');

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(text()).toContain('Kraków → Gdziekolwiek');
    expect(text()).toContain('20 gru – 31 gru');
    expect(text()).toContain('2–3 noce');
  });

  it('names a single stay length and the year of dates outside the current one', async () => {
    const { text, found } = await render({ to: '2027-01-13', stayLength: { min: 2, max: 2 } });
    await found(1);
    expect(text()).toContain('20 Dec – 13 Jan 2027');
    expect(text()).toContain('2 nights');
    expect(text()).not.toContain('2–2');
  });

  it('names the fixed dates of a round trip, without nights', async () => {
    const { text, found } = await render({
      dateMode: 'fixed',
      from: '2026-12-04',
      to: '2026-12-07',
      destination: 'BGY',
    });
    await found(1);
    expect(text()).toContain('Kraków → Milan Bergamo');
    expect(text()).toContain('4 Dec – 7 Dec');
    expect(text()).not.toContain('night');
  });

  it('names a one way search on a fixed date', async () => {
    const { text, found } = await render({ kind: 'oneWay', dateMode: 'fixed', from: '2026-12-04' });
    await found(1);
    expect(text()).toContain('One way');
    expect(text()).toContain('4 Dec');
    expect(text()).not.toContain('–');
    expect(text()).not.toContain('night');
  });

  it('names a one way search over a window', async () => {
    const { text, found } = await render({ kind: 'oneWay' });
    await found(1);
    expect(text()).toContain('One way');
    expect(text()).toContain('20 Dec – 31 Dec');
    expect(text()).not.toContain('night');
  });

  it('abbreviates a long list of home airports', async () => {
    const { text, found } = await render({ homeAirports: 'KRK, KTW, BGY' });
    await found(1);
    expect(text()).toContain('Kraków, Katowice +1 →');
  });

  it('reopens the form with every value kept and collapses it again on the next search', async () => {
    const { root, summary, form, visible, fixture, found } = await render({
      stayLength: { min: 1, max: 4 },
    });
    await found(2);

    summary()!.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(summary()).toBeNull();
    expect(visible(form())).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input[formControlName="from"]')!.value).toBe(
      '2026-12-20',
    );
    expect(root.querySelector('[data-place-chip="KRK"]')).not.toBeNull();
    expect(root.querySelector('[data-place-chip="anywhere"]')).not.toBeNull();
    // The results of the earlier search stay while the form is open.
    expect(root.querySelector('[data-testid="results"] h2')).not.toBeNull();

    await found(2);
    expect(visible(form())).toBe(false);
    expect(summary()!.textContent).toContain('1–4 nights');
  });

  it('moves focus to the results heading after a search', async () => {
    const { root, found } = await render();
    await found(3);
    const heading = root.querySelector<HTMLElement>('[data-testid="results"] h2')!;
    expect(heading.textContent?.replace(/\s+/g, ' ')).toBe('3 offers in 1 place, from PLN 100');
    expect(document.activeElement).toBe(heading);
  });

  it('keeps the form open when the search is rejected or fails', async () => {
    const { fixture, root, submit, summary, form, visible } = await render();
    submit();
    http
      .expectOne('/api/search')
      .flush('destination is not supported', { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect(summary()).toBeNull();
    expect(visible(form())).toBe(true);
    expect(root.querySelector('.error[role="alert"]')).not.toBeNull();

    submit();
    http.expectOne('/api/search').flush('boom', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(summary()).toBeNull();
    expect(visible(form())).toBe(true);
  });

  it('keeps the form open when it is invalid', async () => {
    const { fixture, submit, summary } = await render({ homeAirports: '' });
    submit();
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(summary()).toBeNull();
  });

  it('keeps the summary fixed to the top of the page while results scroll', async () => {
    const { summary, found } = await render();
    await found(3);
    const style = getComputedStyle(summary()!);
    expect(style.position).toBe('sticky');
    expect(style.top).toBe('0px');
  });
});
