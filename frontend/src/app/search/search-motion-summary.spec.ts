import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../i18n/testing';
import { flushCatalogue } from './place-testing';
import { Search } from './search';

useSearchClock();

/** The form folding into the summary bar and back, with Angular animations switched on (#81, spec #79). */
describe('Search form and summary bar motion', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
      animationsEnabled: true,
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.match('/api/catalogue');
    http.verify();
    localStorage.clear();
    document.body.replaceChildren();
  });

  async function search() {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        homeAirports: 'KRK',
        destination: 'anywhere',
        from: '2026-12-20',
        to: '2026-12-31',
      }),
    );
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    http.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();
    return { fixture, root };
  }

  it('shows the summary bar and keeps the folding form out of Tab after a search', async () => {
    const { root } = await search();
    expect(root.querySelector('[data-testid="summary"]')).not.toBeNull();
    expect(root.querySelector('.hero')!.closest('[inert]')).not.toBeNull();
  });

  it('brings the form back with its values and focus on its heading, and removes the summary bar', async () => {
    const { fixture, root } = await search();
    root.querySelector<HTMLButtonElement>('[data-testid="summary"] button')!.click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(root.querySelector('[data-testid="summary"]')).toBeNull();
    expect(root.querySelector('.hero')!.closest('[hidden], [inert]')).toBeNull();
    expect(root.querySelector('.hero h1')).toBe(document.activeElement);
    expect(root.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-12-20');
  });
});
