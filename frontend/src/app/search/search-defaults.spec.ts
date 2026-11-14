import { useSearchClock } from './search-testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { provideTestI18n } from '../i18n/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Search } from './search';

/** First-visit defaults: the next 8 weeks to Anywhere (#59). The shared clock is 2026-11-01. */
useSearchClock();

describe('Search first-visit defaults', () => {
  let httpTesting: HttpTestingController;
  const settingsKey = 'gocitybreak.searchSettings.v1';

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
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function dateField(root: HTMLElement, label: string): HTMLInputElement {
    const found = Array.from(root.querySelectorAll('label'))
      .find((l) => l.textContent?.trim().startsWith(label))
      ?.querySelector('input');
    if (!found) throw new Error(`no input labelled ${label}`);
    return found;
  }

  function remember(settings: object) {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }

  it('opens with tomorrow to 8 weeks from today and Anywhere', async () => {
    const { root } = await render();

    expect(dateField(root, 'Earliest').value).toBe('2026-11-02');
    expect(dateField(root, 'Latest').value).toBe('2026-12-27');
    expect(root.querySelector('[data-place-chip="anywhere"]')).not.toBeNull();
  });

  it('searches the default query after choosing only a home airport', async () => {
    const { fixture, root } = await render();
    fillPlace(root, 'From', 'KRK');

    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const req = httpTesting.expectOne('/api/search');
    expect(req.request.body).toMatchObject({
      homeAirports: ['KRK'],
      destination: { anywhere: true },
      travelWindow: { from: '2026-11-02', to: '2026-12-27' },
    });
    req.flush({ offers: [] });
    await fixture.whenStable();
  });

  it('lets remembered dates and destination override the defaults', async () => {
    remember({ destination: 'BGY', from: '2026-12-01', to: '2026-12-10' });

    const { root } = await render();

    expect(dateField(root, 'Earliest').value).toBe('2026-12-01');
    expect(dateField(root, 'Latest').value).toBe('2026-12-10');
    expect(root.querySelector('[data-place-chip="BGY"]')).not.toBeNull();
    expect(root.querySelector('[data-place-chip="anywhere"]')).toBeNull();
  });

  it('replaces a remembered travel window that has ended with the default', async () => {
    remember({ destination: 'BGY', from: '2026-10-01', to: '2026-10-20' });

    const { root } = await render();

    expect(dateField(root, 'Earliest').value).toBe('2026-11-02');
    expect(dateField(root, 'Latest').value).toBe('2026-12-27');
    expect(root.querySelector('[data-place-chip="BGY"]')).not.toBeNull();
  });

  it('keeps a remembered travel window that ends today', async () => {
    remember({ from: '2026-10-25', to: '2026-11-01' });

    const { root } = await render();

    expect(dateField(root, 'Earliest').value).toBe('2026-10-25');
    expect(dateField(root, 'Latest').value).toBe('2026-11-01');
  });

  it('keeps remembered fixed dates as they are', async () => {
    remember({ dateMode: 'fixed', from: '2026-10-01', to: '2026-10-05' });

    const { root } = await render();

    expect(dateField(root, 'Outbound').value).toBe('2026-10-01');
    expect(dateField(root, 'Inbound').value).toBe('2026-10-05');
  });
});
