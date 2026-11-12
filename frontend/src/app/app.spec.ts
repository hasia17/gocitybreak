import { provideTestI18n } from './i18n/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The search form's catalogue request is not what these tests are about.
    httpTesting.match('/api/catalogue');
    httpTesting.verify();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  /** Renders the app; its /api/status request stays pending until the test answers it. */
  function render() {
    const fixture = TestBed.createComponent(App);
    TestBed.tick();
    return fixture;
  }

  it('shows the API version and database status from /api/status', async () => {
    const fixture = render();

    httpTesting.expectOne('/api/status').flush({
      status: 'ok',
      version: '1.2.3',
      database: { status: 'ok', schemaVersion: 1 },
    });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('API: ok');
    expect(text).toContain('Version: 1.2.3');
    expect(text).toContain('Database: ok');
  });

  it('shows an alert when /api/status fails', async () => {
    const fixture = render();

    httpTesting
      .expectOne('/api/status')
      .flush(
        { status: 'degraded', version: '1.2.3', database: { status: 'unavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await fixture.whenStable();

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('API unavailable');
  });

  describe('language', () => {
    function languageButton(root: HTMLElement, code: string) {
      return Array.from(root.querySelectorAll<HTMLButtonElement>('header button')).find(
        (b) => b.textContent?.trim() === code,
      )!;
    }

    it('starts in Polish for a Polish browser, with Polish formats', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('pl-PL');
      const fixture = render();
      httpTesting
        .expectOne('/api/status')
        .flush({ status: 'ok', version: '1', database: { status: 'ok' } });
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;

      expect(root.querySelector('h1')?.textContent).toBe('Gdzie na weekend?');
      expect(root.textContent).toContain('Wersja: 1');
      expect(languageButton(root, 'PL').getAttribute('aria-pressed')).toBe('true');
      expect(document.documentElement.lang).toBe('pl');
    });

    it('starts in English for any other browser language', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
      const fixture = render();
      httpTesting
        .expectOne('/api/status')
        .flush({ status: 'ok', version: '1', database: { status: 'ok' } });
      await fixture.whenStable();

      expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
        'Where to this weekend?',
      );
    });

    it('switches language without a reload, keeping what was typed, and remembers the choice', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
      const fixture = render();
      httpTesting
        .expectOne('/api/status')
        .flush({ status: 'ok', version: '1', database: { status: 'ok' } });
      await fixture.whenStable();
      let root = fixture.nativeElement as HTMLElement;
      const from = root.querySelector<HTMLInputElement>('input[formControlName="homeAirports"]')!;
      from.value = 'KRK';
      from.dispatchEvent(new Event('input'));

      languageButton(root, 'PL').click();
      await fixture.whenStable();

      expect(root.querySelector('h1')?.textContent).toBe('Gdzie na weekend?');
      expect(root.querySelector<HTMLSelectElement>('select')?.getAttribute('aria-label')).toBe(
        'Sortuj według',
      );
      expect(
        root.querySelector<HTMLInputElement>('input[formControlName="homeAirports"]')!.value,
      ).toBe('KRK');
      expect(languageButton(root, 'PL').getAttribute('aria-pressed')).toBe('true');
      fixture.destroy();

      // The next visit starts in the chosen language, whatever the browser says.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
      }).compileComponents();
      httpTesting = TestBed.inject(HttpTestingController);
      const next = render();
      httpTesting
        .expectOne('/api/status')
        .flush({ status: 'ok', version: '1', database: { status: 'ok' } });
      await next.whenStable();
      root = next.nativeElement as HTMLElement;
      expect(root.querySelector('h1')?.textContent).toBe('Gdzie na weekend?');
    });
  });
});
