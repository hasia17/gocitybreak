import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../i18n/testing';
import fixedDatesRequest from '../../../../contract/fixed-dates.request.json';
import fixedDatesResponse from '../../../../contract/fixed-dates.response.json';
import fixedOneWayRequest from '../../../../contract/fixed-one-way.request.json';
import fixedOneWayResponse from '../../../../contract/fixed-one-way.response.json';
import { Search } from './search';

describe('Fixed dates search', () => {
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
    localStorage.clear();
  });
  async function render() {
    const fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }
  function fill(root: HTMLElement, name: string, value: string) {
    const el = root.querySelector<HTMLInputElement>(`input[formControlName="${name}"]`)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }
  function mode(root: HTMLElement, value: string) {
    const input = root.querySelector<HTMLInputElement>(`input[value="${value}"]`);
    expect(input, `date mode ${value} is available`).not.toBeNull();
    input!.click();
  }
  function submit(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }

  it('defaults to flexible dates, sends the fixed round-trip contract and remembers the choice', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector<HTMLInputElement>('input[value="flexible"]')?.checked).toBe(true);
    mode(root, 'fixed');
    await fixture.whenStable();
    expect(root.querySelector('[formGroupName="stayLength"]')).toBeNull();
    expect(root.querySelectorAll('fieldset.days')).toHaveLength(0);
    fill(root, 'homeAirports', 'KRK');
    fill(root, 'destination', 'BGY');
    fill(root, 'from', '2026-12-04');
    fill(root, 'to', '2026-12-06');
    submit(root);
    const req = http.expectOne('/api/search');
    expect(req.request.body).toEqual(fixedDatesRequest);
    req.flush(fixedDatesResponse);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('2 nights');
    fixture.destroy();
    const restored = await render();
    expect(restored.root.querySelector<HTMLInputElement>('input[value="fixed"]')?.checked).toBe(
      true,
    );
    expect(
      restored.root.querySelector<HTMLInputElement>('input[formControlName="from"]')?.value,
    ).toBe('2026-12-04');
  });
  it('rejects an inbound date before the outbound date and marks the date for correction', async () => {
    const { fixture, root } = await render();
    mode(root, 'fixed');
    await fixture.whenStable();
    fill(root, 'homeAirports', 'KRK');
    fill(root, 'destination', 'BGY');
    fill(root, 'from', '2026-12-06');
    fill(root, 'to', '2026-12-04');
    submit(root);
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(root.textContent).toContain('The inbound date must not be before the outbound date.');
    expect(root.querySelector('input[formControlName="to"]')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('sends one fixed local departure date for a one-way search, ignoring the hidden inbound date', async () => {
    const { fixture, root } = await render();
    mode(root, 'fixed');
    mode(root, 'oneWay');
    await fixture.whenStable();
    expect(root.querySelector('input[type="date"][formControlName="to"]')).toBeNull();
    fill(root, 'homeAirports', 'KRK');
    fill(root, 'destination', 'BGY');
    fill(root, 'from', '2026-12-05');
    submit(root);
    const req = http.expectOne('/api/search');
    expect(req.request.body).toEqual(fixedOneWayRequest);
    req.flush(fixedOneWayResponse);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="offer"]')?.textContent).toContain('KRK → BGY');
    mode(root, 'flexible');
    await fixture.whenStable();
    expect(root.querySelector('input[formControlName="to"]')).not.toBeNull();
    expect(root.querySelectorAll('fieldset.days')).toHaveLength(1);
  });

  it('keeps the time, direct and leave filters and restores flexible nights and weekdays', async () => {
    const { fixture, root } = await render();
    fill(root, 'homeAirports', 'KRK');
    fill(root, 'destination', 'BGY');
    fill(root, 'from', '2026-12-04');
    fill(root, 'to', '2026-12-06');
    const min = root.querySelector<HTMLInputElement>('input[aria-label="Minimum nights"]')!;
    min.value = '';
    min.dispatchEvent(new Event('input'));
    const outboundDays = Array.from(root.querySelectorAll('fieldset')).find((f) =>
      f.querySelector('legend')?.textContent?.includes('Outbound departure days'),
    )!;
    for (const name of ['Fri', 'Sat', 'Sun']) {
      Array.from(outboundDays.querySelectorAll('label'))
        .find((l) => l.textContent?.trim() === name)!
        .querySelector('input')!
        .click();
    }
    mode(root, 'fixed');
    await fixture.whenStable();
    root.querySelector<HTMLInputElement>('input[formControlName="directOnly"]')!.click();
    const from = root.querySelector<HTMLInputElement>(
      'input[aria-label="Outbound departure from"]',
    )!;
    const to = root.querySelector<HTMLInputElement>('input[aria-label="Outbound departure to"]')!;
    from.value = '22:00';
    from.dispatchEvent(new Event('input'));
    to.value = '23:59';
    to.dispatchEvent(new Event('input'));
    fill(root, 'workStart', '08:00');
    fill(root, 'workEnd', '16:00');
    fill(root, 'maxLeaveDays', '1');
    submit(root);
    const req = http.expectOne('/api/search');
    expect(req.request.body).toEqual({
      ...fixedDatesRequest,
      workStart: '08:00',
      workEnd: '16:00',
      maxLeaveDays: 1,
      filters: { directOnly: true, outboundDeparture: { from: '22:00', to: '23:59' } },
    });
    req.flush({ offers: [] });
    mode(root, 'flexible');
    await fixture.whenStable();
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Minimum nights"]')?.value).toBe(
      '',
    );
    submit(root);
    http.expectNone('/api/search');
    expect(root.textContent).toContain('leave at least one departure day ticked');
  });
});
