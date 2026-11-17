import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { Search } from './search';

/** Keep the 2026 search fixtures in the future while Angular's scheduling stays real. */
export function useSearchClock() {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 1, 12).getTime());
  });
  afterEach(() => vi.restoreAllMocks());
}

/**
 * The set-up and tear-down of the motion specs: the fixed clock, and a Search test bed with
 * Angular animations switched on. Call it once inside a `describe`; `http` is set per test.
 */
export function useAnimatedSearch() {
  useSearchClock();
  const harness = { http: undefined as unknown as HttpTestingController };
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
      animationsEnabled: true,
    }).compileComponents();
    harness.http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    harness.http.match('/api/catalogue');
    harness.http.verify();
    localStorage.clear();
    document.body.replaceChildren();
  });
  return harness;
}

/** Renders Search with its catalogue loaded. */
export async function renderSearch() {
  const fixture = TestBed.createComponent(Search);
  flushCatalogue();
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

/** Fills in a valid round-trip search from Kraków. */
export function fillSearch(root: HTMLElement, destination = 'BGY') {
  fillPlace(root, 'From', 'KRK');
  fillPlace(root, 'To', destination);
  for (const [name, value] of Object.entries({ from: '2026-12-01', to: '2026-12-10' })) {
    const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
}
