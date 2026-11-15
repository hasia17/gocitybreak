import { useSearchClock } from './search-testing';
import { fillPlace } from './place-testing';
import { provideTestI18n } from '../i18n/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import roundTripRequest from '../../../../contract/round-trip.request.json';
import roundTripResponse from '../../../../contract/round-trip.response.json';
import oneWayRequest from '../../../../contract/one-way.request.json';
import oneWayResponse from '../../../../contract/one-way.response.json';
import foreignCurrencyRequest from '../../../../contract/foreign-currency.request.json';
import foreignCurrencyResponse from '../../../../contract/foreign-currency.response.json';
import queryErrorResponse from '../../../../contract/query-error.response.txt?raw';
import { Search } from './search';

useSearchClock();

describe('shared search HTTP contract', () => {
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
  });

  async function search(kind: 'roundTrip' | 'oneWay', stay?: { min: string; max: string }) {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    if (kind === 'oneWay') {
      root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.click();
      await fixture.whenStable();
    }
    function fill(label: string, value: string) {
      if (fillPlace(root, label, value)) return;
      const input = Array.from(root.querySelectorAll('label'))
        .find((element) => element.textContent?.trim().startsWith(label))!
        .querySelector('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fill('From', 'KRK');
    fill('To', 'BGY');
    fill('Earliest', '2026-12-01');
    fill('Latest', '2026-12-10');
    if (stay) {
      for (const [which, value] of [
        ['Minimum', stay.min],
        ['Maximum', stay.max],
      ]) {
        const input = root.querySelector<HTMLInputElement>(`input[aria-label="${which} nights"]`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
    }
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    return { fixture, root };
  }

  it('sends the round-trip request and renders the shared response', async () => {
    const { fixture, root } = await search('roundTrip');
    const req = http.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual(roundTripRequest);
    req.flush(roundTripResponse);
    await fixture.whenStable();
    const offer = root.querySelector('[data-testid="offer"]')!.textContent!.replace(/\s+/g, ' ');
    expect(offer).toContain('KRK Kraków → BGY Bergamo');
    expect(offer).toContain('BGY Bergamo → KRK Kraków');
    expect(offer).toContain('2 nights');
    expect(offer).toContain('PLN 90');
  });

  it('sends the one-way request and renders the shared response', async () => {
    const { fixture, root } = await search('oneWay');
    const req = http.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual(oneWayRequest);
    req.flush(oneWayResponse);
    await fixture.whenStable();
    const offer = root.querySelector('[data-testid="offer"]')!.textContent!;
    expect(offer).toContain('KRK Kraków → BGY Bergamo');
    expect(offer).toContain('PLN 89');
    expect(offer).not.toContain('nights');
  });

  it('renders the shared foreign-currency offer', async () => {
    const { fixture, root } = await search('roundTrip', { min: '0', max: '10' });
    const req = http.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual(foreignCurrencyRequest);
    req.flush(foreignCurrencyResponse);
    await fixture.whenStable();
    const offer = root.querySelector('[data-testid="offer"]')!.textContent!;
    expect(offer).toContain('PLN 135');
    expect(offer).toContain('€19.99');
  });

  it('handles the shared plain-text query error', async () => {
    // The form blocks the fixture's invalid range locally; a server can still reject a valid form.
    const { fixture, root } = await search('roundTrip');
    const req = http.expectOne({ method: 'POST', url: '/api/search' });
    expect(req.request.body).toEqual(roundTripRequest);
    req.flush(queryErrorResponse, {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'text/plain' },
    });
    await fixture.whenStable();
    expect(root.textContent).toContain(
      'Check the minimum and maximum nights; fixed dates do not use a stay length.',
    );
  });
});
