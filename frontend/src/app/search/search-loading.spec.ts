import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import roundTripResponse from '../../../../contract/round-trip.response.json';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { Search } from './search';

/** Search progress through the search DOM and HTTP boundary (#41). */
useSearchClock();

describe('Search loading', () => {
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

  it('shows and announces translated progress on first and repeat searches, ending on success or failure', async () => {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', 'anywhere');
    for (const [name, value] of Object.entries({ from: '2026-12-01', to: '2026-12-10' })) {
      const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    let hasOffers = false;

    // Both the first request and requests following a success/failure must show progress.
    for (const failure of [true, false, true, false]) {
      submit.click();
      const request = http.expectOne('/api/search');
      await fixture.whenStable();

      const results = root.querySelector<HTMLElement>('[data-testid="results"]');
      expect(results?.getAttribute('aria-busy')).toBe('true');
      const progress = root.querySelector<HTMLElement>('[role="status"]');
      expect(progress?.textContent?.trim()).toBe('Searching for offers…');
      expect(progress?.hidden).toBe(false);
      // A busy ancestor can defer live announcements until the request has already ended.
      expect(progress?.closest('[aria-busy="true"]')).toBeNull();
      expect(submit.disabled).toBe(true);
      expect(root.querySelectorAll('[data-testid="offer"]')).toHaveLength(hasOffers ? 1 : 0);
      if (hasOffers) expect(results?.querySelector('h2')?.textContent).toBe('1 offer');

      TestBed.inject(TranslocoService).setActiveLang('pl');
      await fixture.whenStable();
      expect(progress?.textContent?.trim()).toBe('Szukamy ofert…');

      if (failure) request.flush({}, { status: 500, statusText: 'Server error' });
      else {
        request.flush(roundTripResponse);
        hasOffers = true;
      }
      await fixture.whenStable();

      expect(results?.getAttribute('aria-busy')).toBe('false');
      expect(progress?.textContent?.trim()).toBe('');
      expect(submit.disabled).toBe(false);
      if (failure) expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
      else expect(results?.querySelector('h2')?.textContent).toBe('1 oferta');

      TestBed.inject(TranslocoService).setActiveLang('en');
      await fixture.whenStable();
    }
  });
});
