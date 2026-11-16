import { useSearchClock } from './search-testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { Search } from './search';

/** Leave planning through the visible form and the search HTTP boundary (#34). */
useSearchClock();

describe('Search leave limit', () => {
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
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function findInput(root: HTMLElement, label: string): HTMLInputElement | undefined {
    return (
      Array.from(root.querySelectorAll<HTMLInputElement>('input')).find(
        (i) => i.getAttribute('aria-label') === label,
      ) ??
      Array.from(root.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input') ??
      undefined
    );
  }

  function input(root: HTMLElement, label: string): HTMLInputElement {
    const found = findInput(root, label);
    if (!found) throw new Error(`no input labelled ${label}`);
    return found;
  }

  function fill(root: HTMLElement, label: string, value: string) {
    if (fillPlace(root, label, value)) return;
    const el = input(root, label);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function fillTrip(root: HTMLElement) {
    fill(root, 'From', 'KRK');
    fill(root, 'To', 'BGY');
    fill(root, 'Earliest', '2026-12-01');
    fill(root, 'Latest', '2026-12-10');
  }

  function search(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    return httpTesting.expectOne('/api/search');
  }

  it('removes the leave limit and hides its fields while preserving work hours and leave sorting', async () => {
    localStorage.setItem('gocitybreak.searchSettings.v1', JSON.stringify({ sort: 'leaveDays' }));
    const { fixture, root } = await render();
    fillTrip(root);
    fill(root, 'Work start', '08:00');
    fill(root, 'Work end', '16:00');
    fill(root, 'Max leave days', '1');

    const leaveSwitch = input(root, "I don't worry about leave");
    expect(leaveSwitch.checked).toBe(false);
    expect(leaveSwitch.getAttribute('role')).toBe('switch');
    leaveSwitch.click();
    await fixture.whenStable();

    expect(findInput(root, 'Work start')).toBeUndefined();
    expect(findInput(root, 'Work end')).toBeUndefined();
    expect(findInput(root, 'Max leave days')).toBeUndefined();
    const request = search(root);
    expect(request.request.body).not.toHaveProperty('maxLeaveDays');
    expect(request.request.body).toMatchObject({
      workStart: '08:00',
      workEnd: '16:00',
      sort: 'leaveDays',
    });
    const fetchedAt = new Date().toISOString();
    const flight = (from: string, to: string, date: string) => ({
      airline: 'ryanair' as const,
      departureAirport: from,
      arrivalAirport: to,
      departure: { date, time: '10:00', timeZone: 'Europe/Warsaw' },
      arrival: { date, time: '12:00', timeZone: 'Europe/Rome' },
      originalPrice: { amount: 100, currency: 'PLN' },
      fetchedAt,
    });
    request.flush({
      offers: [
        {
          kind: 'roundTrip',
          outbound: { isDirect: true, flights: [flight('KRK', 'BGY', '2026-12-04')] },
          inbound: { isDirect: true, flights: [flight('BGY', 'KRK', '2026-12-06')] },
          nights: 2,
          leaveDays: 3,
          price: { amount: 200, currency: 'PLN', approximate: false },
          priceFetchedAt: fetchedAt,
        },
      ],
    });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('3 leave days');
    expect(
      root.querySelector<HTMLInputElement>('[aria-label="Sort by"] input:checked')!.value,
    ).toBe('leaveDays');
  });

  it('does not let a hidden leave limit block searching', async () => {
    const { fixture, root } = await render();
    fillTrip(root);
    fill(root, 'Max leave days', '-1');
    input(root, "I don't worry about leave").click();
    await fixture.whenStable();

    const request = search(root);
    expect(request.request.body).not.toHaveProperty('maxLeaveDays');
    expect(request.request.body).toMatchObject({ workStart: '09:00', workEnd: '17:00' });
    request.flush({ offers: [] });
  });

  it('uses the last valid work hours when cleared fields are hidden and remembers them', async () => {
    const first = await render();
    fillTrip(first.root);
    fill(first.root, 'Work start', '07:30');
    fill(first.root, 'Work end', '15:30');
    fill(first.root, 'Work start', '');
    fill(first.root, 'Work end', '');
    input(first.root, "I don't worry about leave").click();
    await first.fixture.whenStable();
    expect(findInput(first.root, 'Work start')).toBeUndefined();
    const ignored = search(first.root);
    expect(ignored.request.body).toMatchObject({ workStart: '07:30', workEnd: '15:30' });
    expect(ignored.request.body).not.toHaveProperty('maxLeaveDays');
    ignored.flush({ offers: [] });
    first.fixture.destroy();

    const { fixture, root } = await render();
    input(root, "I don't worry about leave").click();
    await fixture.whenStable();
    expect(input(root, 'Work start').value).toBe('07:30');
    expect(input(root, 'Work end').value).toBe('15:30');
    fill(root, 'Work end', '16:00');
    const restored = search(root);
    expect(restored.request.body).toMatchObject({ workStart: '07:30', workEnd: '16:00' });
    restored.flush({ offers: [] });
  });
  it('remembers the switch and restores work hours and the leave limit when switched off', async () => {
    const first = await render();
    fillTrip(first.root);
    fill(first.root, 'Work start', '07:30');
    fill(first.root, 'Work end', '15:30');
    fill(first.root, 'Max leave days', '0');
    input(first.root, "I don't worry about leave").click();
    search(first.root).flush({ offers: [] });
    first.fixture.destroy();

    const { fixture, root } = await render();
    expect(input(root, "I don't worry about leave").checked).toBe(true);
    expect(findInput(root, 'Work start')).toBeUndefined();
    const ignored = search(root);
    expect(ignored.request.body).not.toHaveProperty('maxLeaveDays');
    expect(ignored.request.body).toMatchObject({ workStart: '07:30', workEnd: '15:30' });
    ignored.flush({ offers: [] });
    await fixture.whenStable();

    input(root, "I don't worry about leave").click();
    await fixture.whenStable();
    expect(input(root, 'Work start').value).toBe('07:30');
    expect(input(root, 'Work end').value).toBe('15:30');
    expect(input(root, 'Max leave days').value).toBe('0');
    const limited = search(root);
    expect(limited.request.body).toMatchObject({
      workStart: '07:30',
      workEnd: '15:30',
      maxLeaveDays: 0,
    });
    limited.flush({ offers: [] });
  });

  it('keeps the leave switch and hidden limit when changing the offer kind', async () => {
    const { fixture, root } = await render();
    fillTrip(root);
    fill(root, 'Max leave days', '-1');
    input(root, "I don't worry about leave").click();
    root.querySelector<HTMLInputElement>('input[value="oneWay"]')!.click();
    await fixture.whenStable();
    expect(findInput(root, "I don't worry about leave")).toBeUndefined();
    root.querySelector<HTMLInputElement>('input[value="roundTrip"]')!.click();
    await fixture.whenStable();
    expect(input(root, "I don't worry about leave").checked).toBe(true);
    const request = search(root);
    expect(request.request.body).not.toHaveProperty('maxLeaveDays');
    request.flush({ offers: [] });
  });

  it('keeps the leave limit enabled for older settings without the switch', async () => {
    localStorage.setItem(
      'gocitybreak.searchSettings.v1',
      JSON.stringify({
        leave: { workStart: '08:30', workEnd: '16:30', maxLeaveDays: 2 },
      }),
    );
    const { root } = await render();
    expect(input(root, "I don't worry about leave").checked).toBe(false);
    fillTrip(root);
    const request = search(root);
    expect(request.request.body).toMatchObject({
      workStart: '08:30',
      workEnd: '16:30',
      maxLeaveDays: 2,
    });
    request.flush({ offers: [] });
  });

  it('translates the leave switch into Polish without changing the selection', async () => {
    const { fixture, root } = await render();
    input(root, "I don't worry about leave").click();
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(input(root, 'Nie martwię się urlopem').checked).toBe(true);
    input(root, 'Nie martwię się urlopem').click();
    await fixture.whenStable();
    expect(input(root, 'Początek pracy').value).toBe('09:00');
  });
});
