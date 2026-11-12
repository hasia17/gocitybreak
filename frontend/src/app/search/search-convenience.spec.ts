import { fillPlace, flushCatalogue } from './place-testing';
import { provideTestI18n } from '../i18n/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { Search } from './search';

/** Remembered settings, Ryanair links and the empty result (#10). */
describe('Search conveniences', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // These tests type only airport codes and leave the catalogue request unanswered.
    httpTesting.match('/api/catalogue');
    httpTesting.verify();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function input(root: HTMLElement, label: string): HTMLInputElement {
    const found =
      Array.from(root.querySelectorAll<HTMLInputElement>('input')).find(
        (i) => i.getAttribute('aria-label') === label,
      ) ??
      Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input');
    if (!found) throw new Error(`no input labelled ${label}`);
    return found;
  }

  function fill(root: HTMLElement, label: string, value: string) {
    if (fillPlace(root, label, value)) return;
    const el = input(root, label);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function nights(root: HTMLElement, which: 'Minimum' | 'Maximum') {
    return root.querySelector<HTMLInputElement>(`input[aria-label="${which} nights"]`);
  }

  function search(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }

  const fetchedAt = new Date().toISOString();

  function flight(from: string, to: string, date: string) {
    return {
      departureAirport: from,
      arrivalAirport: to,
      departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 100, currency: 'PLN' },
      fetchedAt,
    };
  }

  function offer(outbound: object[], inbound?: object[]) {
    return {
      kind: inbound ? 'roundTrip' : 'oneWay',
      outbound: { isDirect: outbound.length === 1, flights: outbound },
      ...(inbound && { inbound: { isDirect: inbound.length === 1, flights: inbound }, nights: 2 }),
      price: { amount: 200, currency: 'PLN', approximate: false },
      priceFetchedAt: fetchedAt,
    };
  }

  /** Searches and shows the given offers; returns the rendered offer's Ryanair links. */
  async function showOffer(o: object) {
    const { fixture, root } = await render();
    fill(root, 'From', 'KRK, KTW');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    search(root);
    httpTesting.expectOne('/api/search').flush({ offers: [o] });
    await fixture.whenStable();
    const rendered = root.querySelector<HTMLElement>('[data-testid="offer"]')!;
    const links = Array.from(rendered.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => ({
      url: new URL(a.href),
      text: a.textContent!.replace(/\s+/g, ' ').trim(),
      target: a.target,
    }));
    return { rendered, links };
  }

  it('restores the last search settings on the next visit', async () => {
    const first = await render();
    fill(first.root, 'From', 'KRK, KTW');
    fill(first.root, 'To', 'BGY');
    fill(first.root, 'Earliest', '2026-12-01');
    fill(first.root, 'Latest', '2026-12-10');
    const max = nights(first.root, 'Maximum')!;
    max.value = '4';
    max.dispatchEvent(new Event('input'));
    search(first.root);
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    first.fixture.destroy();

    const { root } = await render();

    expect(root.querySelector('[data-place-chip="KRK"]')).not.toBeNull();
    expect(root.querySelector('[data-place-chip="KTW"]')).not.toBeNull();
    expect(root.querySelector('[data-place-chip="BGY"]')).not.toBeNull();
    expect(input(root, 'Earliest').value).toBe('2026-12-01');
    expect(input(root, 'Latest').value).toBe('2026-12-10');
    expect(nights(root, 'Minimum')!.value).toBe('2');
    expect(nights(root, 'Maximum')!.value).toBe('4');
  });

  it('restores a one-way search as one way, without nights', async () => {
    const first = await render();
    first.root.querySelector<HTMLInputElement>('input[type="radio"][value="oneWay"]')!.click();
    fill(first.root, 'From', 'BGY');
    fill(first.root, 'To', 'KRK');
    fill(first.root, 'Earliest', '2026-12-01');
    fill(first.root, 'Latest', '2026-12-10');
    search(first.root);
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    first.fixture.destroy();

    const { root } = await render();

    expect(root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.checked).toBe(true);
    expect(nights(root, 'Minimum')).toBeNull();
    expect(root.querySelector('[data-place-chip="BGY"]')).not.toBeNull();
  });

  it('starts from the defaults and still searches when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { root } = await render();
    expect(input(root, 'From').value).toBe('');
    expect(root.querySelector<HTMLInputElement>('input[value="roundTrip"]')!.checked).toBe(true);

    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    search(root);

    httpTesting.expectOne('/api/search').flush({ offers: [] });
  });

  it('restores what it can of settings remembered in an older shape', async () => {
    // The sort used to be remembered among the work hours.
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({ homeAirports: 'KTW', leave: { workStart: '07:30', sort: 'leaveDays' } }),
    );
    const { root } = await render();

    expect(root.querySelector('[data-place-chip="KTW"]')).not.toBeNull();
    expect(input(root, 'Work start').value).toBe('07:30');
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input:checked')!.value,
    ).toBe('price');
  });

  it('ticks every departure day of settings remembered when no tick meant any day', async () => {
    const none = {
      mon: false,
      tue: false,
      wed: false,
      thu: false,
      fri: false,
      sat: false,
      sun: false,
    };
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        filters: {
          outboundDepartureWeekdays: none,
          inboundDepartureWeekdays: { ...none, sun: true, mon: true },
        },
      }),
    );
    const { root } = await render();
    const ticked = (legend: string) =>
      Array.from(root.querySelectorAll('fieldset'))
        .find((f) => f.querySelector('legend')?.textContent?.trim().startsWith(legend))!
        .querySelectorAll<HTMLInputElement>('input:checked').length;

    expect(ticked('Outbound departure days')).toBe(7);
    expect(ticked('Inbound departure days')).toBe(2);
  });

  it('sorts by price when the remembered sort no longer exists', async () => {
    // Price per night was removed (#33).
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({ homeAirports: 'KRK', sort: 'pricePerNight' }),
    );
    const { root } = await render();
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input:checked')!.value,
    ).toBe('price');

    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
    search(root);

    expect(httpTesting.expectOne('/api/search').request.body.sort).toBe('price');
  });

  it('ignores stored settings it cannot read', async () => {
    localStorage.setItem('gocitybreak.searchSettings.v1', '{not json');
    const { root } = await render();

    expect(input(root, 'From').value).toBe('');
    expect(nights(root, 'Minimum')!.value).toBe('2');
  });

  it('links a round trip returning to the same home airport to one Ryanair round-trip booking', async () => {
    const { links } = await showOffer(
      offer([flight('KRK', 'BGY', '2026-12-04')], [flight('BGY', 'KRK', '2026-12-06')]),
    );

    expect(links).toHaveLength(1);
    const [{ url, text, target }] = links;
    expect(url.origin + url.pathname).toMatch(
      /^https:\/\/www\.ryanair\.com\/.*\/trip\/flights\/select$/,
    );
    expect(url.searchParams.get('originIata')).toBe('KRK');
    expect(url.searchParams.get('destinationIata')).toBe('BGY');
    expect(url.searchParams.get('dateOut')).toBe('2026-12-04');
    expect(url.searchParams.get('dateIn')).toBe('2026-12-06');
    expect(url.searchParams.get('isReturn')).toBe('true');
    expect(url.searchParams.get('adults')).toBe('1');
    expect(text).toContain('Ryanair');
    expect(target).toBe('_blank');
  });

  it('links a round trip returning to a different home airport to two one-way bookings, labelled as separate tickets', async () => {
    const { rendered, links } = await showOffer(
      offer([flight('KRK', 'BGY', '2026-12-04')], [flight('BGY', 'KTW', '2026-12-06')]),
    );

    expect(
      links.map(({ url, text }) => ({
        text,
        origin: url.searchParams.get('originIata'),
        destination: url.searchParams.get('destinationIata'),
        dateOut: url.searchParams.get('dateOut'),
        isReturn: url.searchParams.get('isReturn'),
      })),
    ).toEqual([
      {
        text: 'KRK → BGY on Ryanair ↗',
        origin: 'KRK',
        destination: 'BGY',
        dateOut: '2026-12-04',
        isReturn: 'false',
      },
      {
        text: 'BGY → KTW on Ryanair ↗',
        origin: 'BGY',
        destination: 'KTW',
        dateOut: '2026-12-06',
        isReturn: 'false',
      },
    ]);
    expect(rendered.textContent).toContain('Booked as 2 separate one-way tickets');
  });

  it('shows found offers again in the language switched to, without searching again', async () => {
    const { rendered } = await showOffer(
      offer([flight('KRK', 'BGY', '2026-12-04')], [flight('BGY', 'KTW', '2026-12-06')]),
    );
    expect(rendered.textContent).toContain('2 nights');

    TestBed.inject(TranslocoService).setActiveLang('pl');
    await TestBed.inject(ApplicationRef).whenStable();

    const text = document.querySelector('[data-testid="offer"]')!.textContent!;
    expect(text).toContain('pt 4 gru');
    expect(text).toContain('2 noce');
    expect(text).toContain('200,00 zł');
    expect(text).toContain('Kupowane jako 2 osobne bilety w jedną stronę');
    expect(text).toContain('sprawdzono 0 min temu');
  });

  it('links a one-way offer to one Ryanair one-way booking', async () => {
    const { rendered, links } = await showOffer(offer([flight('KRK', 'BGY', '2026-12-04')]));

    expect(links).toHaveLength(1);
    const [{ url, text }] = links;
    expect(text).toBe('Book on Ryanair ↗');
    expect(url.searchParams.get('originIata')).toBe('KRK');
    expect(url.searchParams.get('destinationIata')).toBe('BGY');
    expect(url.searchParams.get('dateOut')).toBe('2026-12-04');
    expect(url.searchParams.get('isReturn')).toBe('false');
    expect(rendered.textContent).not.toContain('separate');
  });

  it('links each flight of a self-transfer to its own one-way booking', async () => {
    const { rendered, links } = await showOffer(
      offer([flight('KRK', 'STN', '2026-12-04'), flight('STN', 'BGY', '2026-12-04')]),
    );

    expect(links.map((l) => l.text)).toEqual(['KRK → STN on Ryanair ↗', 'STN → BGY on Ryanair ↗']);
    expect(rendered.textContent).toContain('Booked as 2 separate one-way tickets');
  });

  it('suggests loosening the criteria when no offer matches', async () => {
    const { fixture, root } = await render();
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-02');
    search(root);
    httpTesting.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();

    const results = root.querySelector('[data-testid="results"]')!.textContent!;
    expect(results).toContain('No offers match');
    expect(results).toMatch(/loosen/i);
    expect(results).toContain('leave days');
    expect(results).toContain('time ranges');
    expect(results).toContain('weekdays');
  });
});
