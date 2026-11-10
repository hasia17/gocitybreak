import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

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
});
