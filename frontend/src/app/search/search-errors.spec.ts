import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { vi } from 'vitest';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { Search } from './search';

describe('Search date validation and failures', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 12, 12).getTime());
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    localStorage.clear();
  });
  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', 'BGY');
    fill(root, 'from', '2026-12-04');
    fill(root, 'to', '2026-12-06');
    return { fixture, root };
  }
  function fill(root: HTMLElement, name: string, value: string) {
    const input = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function submit(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }

  it.each(['roundTrip', 'oneWay'])('blocks a reversed flexible travel window for %s', async (kind) => {
    const { fixture, root } = await render();
    root.querySelector<HTMLInputElement>(`input[value="${kind}"]`)!.click();
    fill(root, 'from', '2026-12-06');
    fill(root, 'to', '2026-12-04');
    submit(root);
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(root.querySelector('input[formControlName="to"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it.each([
    ['flexible', 'roundTrip', 'from'],
    ['flexible', 'roundTrip', 'to'],
    ['flexible', 'oneWay', 'from'],
    ['flexible', 'oneWay', 'to'],
    ['fixed', 'roundTrip', 'from'],
    ['fixed', 'roundTrip', 'to'],
    ['fixed', 'oneWay', 'from'],
  ])('blocks a past %s %s %s date before sending', async (mode, kind, field) => {
    const { fixture, root } = await render();
    root.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!.click();
    root.querySelector<HTMLInputElement>(`input[value="${kind}"]`)!.click();
    await fixture.whenStable();
    // Both past dates keep date order valid so this exercises the past-date rule itself.
    fill(root, 'from', field === 'to' ? '2026-11-10' : '2026-11-11');
    if (root.querySelector('input[formControlName="to"]'))
      fill(root, 'to', field === 'to' ? '2026-11-11' : '2026-12-06');
    submit(root);
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(root.querySelector(`input[formControlName="${field}"]`)?.getAttribute('aria-invalid')).toBe('true');
  });

  it('accepts browser-local today and rechecks unchanged dates after local midnight', async () => {
    // Late evening is still today in the browser's local calendar.
    vi.mocked(Date.now).mockReturnValue(new Date(2026, 10, 12, 23, 59).getTime());
    const { fixture, root } = await render();
    fill(root, 'from', '2026-11-12');
    fill(root, 'to', '2026-11-13');
    submit(root);
    http.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();
    vi.mocked(Date.now).mockReturnValue(new Date(2026, 10, 13, 0, 1).getTime());
    submit(root);
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(root.querySelector('input[formControlName="from"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('ignores the remembered past inbound date for a fixed one-way search', async () => {
    const { fixture, root } = await render();
    fill(root, 'to', '2026-11-11');
    root.querySelector<HTMLInputElement>('input[value="fixed"]')!.click();
    root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.click();
    await fixture.whenStable();
    submit(root);
    const request = http.expectOne('/api/search');
    expect(request.request.body.fixedDates).toEqual({ outbound: '2026-12-04' });
    request.flush({ offers: [] });
  });

  it('translates the backend plain-text 400 reason and switches its language without raw backend text', async () => {
    const { fixture, root } = await render();
    submit(root);
    http.expectOne('/api/search').flush('home airport "ZZZ" is not a supported airport\n', {
      status: 400, statusText: 'Bad Request', headers: { 'Content-Type': 'text/plain' },
    });
    await fixture.whenStable();
    expect(root.textContent).toContain('Choose a supported home airport from the suggestions.');
    expect(root.textContent).not.toContain('home airport "ZZZ"');
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(root.textContent).toContain('Wybierz obsługiwane lotnisko wylotu z podpowiedzi.');
  });
  it.each([
    ['homeAirports must not be empty', 'Choose a supported home airport from the suggestions.'],
    ['destination must name airports, cities or countries, or be anywhere', 'Choose a destination from the suggestions, or Anywhere.'],
    ['travelWindow.to must not be before travelWindow.from', 'The latest date must not be before the earliest date.'],
    ['fixedDates.inbound must not be before fixedDates.outbound', 'The inbound date must not be before the outbound date.'],
    ['fixedDates.outbound must be a date in YYYY-MM-DD format', 'Check your travel dates and choose either flexible or fixed dates.'],
    ['fixedDates.inbound is required for a round trip', 'Check your travel dates and choose either flexible or fixed dates.'],
    ['exactly one of travelWindow or fixedDates is required', 'Check your travel dates and choose either flexible or fixed dates.'],
    ['stayLength must be absent with fixedDates', 'Check the minimum and maximum nights; fixed dates do not use a stay length.'],
    ['stayLength.max must not be less than stayLength.min', 'Check the minimum and maximum nights; fixed dates do not use a stay length.'],
    ['workStart must be a time in HH:MM format', 'Check your work start and work end times.'],
    ['outboundDeparture.from must be a time in HH:MM format', 'Check the departure and arrival time ranges.'],
    ['inboundDepartureWeekdays must list days as mon, tue, wed, thu, fri, sat or sun', 'Check the departure days selected in Filters.'],
    ['maxLeaveDays must not be negative', 'The leave limit must be zero or more.'],
    ['sort "leaveDays" applies to round trips only', 'Choose an available sort order for this kind of offer.'],
    ['kind must be "roundTrip" or "oneWay"', 'Choose round trip or one way.'],
    ['a new backend reason that the frontend does not know', 'This search was rejected. Check your choices and try again.'],
  ])('shows a translated query message for the 400 reason %s', async (reason, message) => {
    const { fixture, root } = await render();
    submit(root);
    http.expectOne('/api/search').flush(reason + '\n', {
      status: 400, statusText: 'Bad Request', headers: { 'Content-Type': 'text/plain' },
    });
    await fixture.whenStable();
    expect(root.textContent).toContain(message);
    expect(root.textContent).not.toContain(reason);
  });

  it.each([500, 503, 0])('shows a distinct retry message for server or network failure %s', async (status) => {
    const { fixture, root } = await render();
    submit(root);
    const request = http.expectOne('/api/search');
    if (status === 0) request.error(new ProgressEvent('error'));
    else request.flush('search failed', { status, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(root.textContent).toContain('Something went wrong on our side. Please try again.');
    expect(root.textContent).not.toContain('Check your choices');
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    // A failed request can be retried and its message clears when the retry succeeds.
    submit(root);
    http.expectOne('/api/search').flush({ offers: [] });
    await fixture.whenStable();
    expect(root.textContent).not.toContain('Something went wrong');
  });
});
