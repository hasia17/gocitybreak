import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue, removeAnywhere } from './place-testing';
import { Search } from './search';

useSearchClock();

describe('Search field validation', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }
  function input(root: HTMLElement, selector: string) {
    return root.querySelector<HTMLInputElement>(selector)!;
  }
  function fill(root: HTMLElement, selector: string, value: string) {
    const el = input(root, selector);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }
  function submit(root: HTMLElement) {
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  }
  function message(root: HTMLElement, el: Element) {
    const ids = el.getAttribute('aria-describedby')?.split(' ') ?? [];
    return ids.map((id) => root.querySelector(`[id="${id}"]`)?.textContent?.trim()).join(' ');
  }
  it('explains each missing place and date beside its input only after searching, in the active language', async () => {
    const { fixture, root } = await render();
    const from = input(root, '[role="combobox"][aria-label="From"]');
    const to = input(root, '[role="combobox"][aria-label="To"]');
    const earliest = input(root, 'input[formControlName="from"]');
    const latest = input(root, 'input[formControlName="to"]');
    // A first visit starts with a travel window and Anywhere; clear them to test the empty form.
    removeAnywhere(root);
    for (const date of [earliest, latest]) {
      date.value = '';
      date.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(message(root, from)).toBe('');
    submit(root);
    await fixture.whenStable();
    http.expectNone('/api/search');
    expect(message(root, from)).toBe('Choose at least one home airport.');
    expect(message(root, to)).toBe('Choose a destination.');
    expect(message(root, earliest)).toBe('Choose a date.');
    expect(message(root, latest)).toBe('Choose a date.');
    expect(root.textContent).not.toContain('both dates and nights');
    TestBed.inject(TranslocoService).setActiveLang('pl');
    await fixture.whenStable();
    expect(message(root, from)).toBe('Wybierz co najmniej jedno lotnisko domowe.');
    TestBed.inject(TranslocoService).setActiveLang('en');
    await fixture.whenStable();
    fillPlace(root, 'From', 'KRK');
    await fixture.whenStable();
    expect(message(root, from)).toBe('');
    expect(from.getAttribute('aria-invalid')).toBe('false');
  });
  it.each(['From', 'To', 'Except'])(
    'asks to choose or clear unfinished %s text while retaining selected chips',
    async (label) => {
      const { fixture, root } = await render();
      fillPlace(root, 'From', 'KRK');
      fillPlace(root, 'To', 'BGY');
      if (label === 'Except') fillPlace(root, 'Except', 'KTW');
      fill(root, 'input[formControlName="from"]', '2026-12-01');
      fill(root, 'input[formControlName="to"]', '2026-12-10');
      const control = input(root, `[role="combobox"][aria-label="${label}"]`);
      control.value = 'Atlantis';
      control.dispatchEvent(new Event('input'));
      control.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
      expect(message(root, control)).toBe('');
      submit(root);
      await fixture.whenStable();
      http.expectNone('/api/search');
      expect(message(root, control)).toBe('Choose a suggestion or clear the typed text.');
      expect(control.closest('app-place-chips')!.querySelector('[data-place-chip]')).not.toBeNull();
      control.value = '';
      control.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(message(root, control)).toBe('');
      submit(root);
      const query = http.expectOne('/api/search');
      expect(query.request.body).toMatchObject({
        homeAirports: ['KRK'],
        destination: { airports: ['BGY'] },
      });
      if (label === 'Except') expect(query.request.body.exclusions).toEqual({ airports: ['KTW'] });
      expect(JSON.stringify(query.request.body)).not.toContain('Atlantis');
      query.flush({ offers: [] });
    },
  );

  it('links an inverted fixed-date error to the inbound date and clears it when the mode no longer applies', async () => {
    const { fixture, root } = await render();
    input(root, 'input[value="fixed"]').click();
    fill(root, 'input[formControlName="from"]', '2026-12-06');
    fill(root, 'input[formControlName="to"]', '2026-12-04');
    submit(root);
    await fixture.whenStable();
    expect(message(root, input(root, 'input[formControlName="to"]'))).toBe(
      'The inbound date must not be before the outbound date.',
    );
    input(root, 'input[value="oneWay"]').click();
    await fixture.whenStable();
    expect(root.textContent).not.toContain('The inbound date must not be before');
    expect(root.querySelector('input[type="date"][formControlName="to"]')).toBeNull();
  });

  it.each([
    ['Minimum nights', '', 'Enter a whole number of nights, zero or more.'],
    ['Maximum nights', '1.5', 'Enter a whole number of nights, zero or more.'],
    ['Minimum nights', '-1', 'Enter a whole number of nights, zero or more.'],
    ['Maximum nights', '1', 'Maximum nights must be at least the minimum.'],
  ])('explains invalid %s (%s) beside the night control', async (label, value, expected) => {
    const { fixture, root } = await render();
    fill(root, `input[aria-label="${label}"]`, value);
    submit(root);
    await fixture.whenStable();
    const control = input(root, `input[aria-label="${label}"]`);
    expect(message(root, control)).toBe(expected);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    input(root, 'input[value="fixed"]').click();
    await fixture.whenStable();
    expect(root.textContent).not.toContain(expected);
  });

  it.each([
    ['workStart', '', 'Enter your work start time.'],
    ['workEnd', '', 'Enter your work end time.'],
    ['maxLeaveDays', '-1', 'Enter a whole number of leave days, zero or more.'],
    ['maxLeaveDays', '1.5', 'Enter a whole number of leave days, zero or more.'],
  ])(
    'explains invalid leave setting %s beside its input and hides it when leave is ignored',
    async (name, value, expected) => {
      const { fixture, root } = await render();
      fill(root, `input[formControlName="${name}"]`, value);
      submit(root);
      await fixture.whenStable();
      expect(message(root, input(root, `input[formControlName="${name}"]`))).toBe(expected);
      input(root, 'input[formControlName="ignoreLeave"]').click();
      await fixture.whenStable();
      expect(root.textContent).not.toContain(expected);
      expect(root.querySelector(`input[formControlName="${name}"]`)).toBeNull();
    },
  );

  it.each(['Outbound departure', 'Outbound arrival', 'Inbound departure', 'Inbound arrival'])(
    'links the half-set %s time range to both ends and clears the message on completion',
    async (label) => {
      const { fixture, root } = await render();
      const start = input(root, `input[aria-label="${label} from"]`);
      const end = input(root, `input[aria-label="${label} to"]`);
      fill(root, `input[aria-label="${label} to"]`, '20:00');
      submit(root);
      await fixture.whenStable();
      expect(message(root, start)).toBe('Enter both ends of the time range or leave both empty.');
      expect(message(root, end)).toBe(message(root, start));
      expect(start.getAttribute('aria-invalid')).toBe('true');
      fill(root, `input[aria-label="${label} from"]`, '18:00');
      await fixture.whenStable();
      expect(message(root, start)).toBe('');
      expect(message(root, end)).toBe('');
      if (label.startsWith('Inbound')) {
        fill(root, `input[aria-label="${label} from"]`, '');
        input(root, 'input[value="oneWay"]').click();
        await fixture.whenStable();
        expect(root.textContent).not.toContain('Enter both ends');
      }
    },
  );

  it.each(['outboundDepartureWeekdays', 'inboundDepartureWeekdays'])(
    'links %s with no possible ticked day to its group and checkboxes',
    async (name) => {
      const { fixture, root } = await render();
      fill(root, 'input[formControlName="from"]', '2026-12-04');
      fill(root, 'input[formControlName="to"]', '2026-12-06');
      await fixture.whenStable();
      const group = root.querySelector(`fieldset[formGroupName="${name}"]`)!;
      const possible = Array.from(group.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));
      possible.forEach((box) => box.click());
      submit(root);
      await fixture.whenStable();
      expect(message(root, group)).toBe('Leave at least one possible departure day ticked.');
      possible.forEach((box) => {
        expect(message(root, box)).toBe(message(root, group));
        expect(box.getAttribute('aria-invalid')).toBe('true');
      });
      possible[0].click();
      await fixture.whenStable();
      expect(message(root, group)).toBe('');
      possible[0].click();
      input(root, 'input[value="fixed"]').click();
      await fixture.whenStable();
      expect(root.textContent).not.toContain('Leave at least one possible');
    },
  );
});
