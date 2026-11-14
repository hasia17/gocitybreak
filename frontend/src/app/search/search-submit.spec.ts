import { useSearchClock } from './search-testing';
import { flushCatalogue } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';

/** The submit button is a text button in the form card, not an icon-only arrow (#55). */
useSearchClock();

describe('Search submit button', () => {
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
    httpTesting.match('/api/catalogue');
    httpTesting.verify();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(Search);
    fixture.detectChanges();
    await fixture.whenStable();
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, button: root.querySelector<HTMLButtonElement>('button[type="submit"]')! };
  }

  it('shows "Search" as its visible text and name', async () => {
    const { button } = await render();
    expect(button.textContent?.trim()).toBe('Search');
    expect(button.getAttribute('aria-label') ?? 'Search').toBe('Search');
  });

  it('shows "Szukaj" in Polish', async () => {
    const { fixture, button } = await render();
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(button.textContent?.trim()).toBe('Szukaj');
    expect(button.getAttribute('aria-label') ?? 'Szukaj').toBe('Szukaj');
  });
});
