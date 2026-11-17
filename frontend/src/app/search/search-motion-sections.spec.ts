import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue, removeAnywhere } from './place-testing';
import { Search } from './search';

useSearchClock();

/** Motion of the Leave and Filters panels, kept toggled with [hidden] (#84, spec #79). */
describe('Search section panel motion', () => {
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
  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function sectionButton(root: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
    ).find((b) => b.textContent?.trim().startsWith(name));
    if (!found) throw new Error(`no section button ${name}`);
    return found;
  }

  function panel(root: HTMLElement, id: string): HTMLElement {
    return root.querySelector<HTMLElement>(`#${id}`)!;
  }

  it.each([
    ['Leave', 'leave-panel'],
    ['Filters', 'filters-panel'],
  ])('makes the %s panel inert at once while it closes', async (name, id) => {
    const { fixture, root } = await render();
    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(false);
    expect(panel(root, id).hasAttribute('inert')).toBe(false);

    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(true);
    expect(panel(root, id).hasAttribute('inert')).toBe(true);

    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(false);
    expect(panel(root, id).hasAttribute('inert')).toBe(false);
  });

  it('still opens a closed Leave section to show a blocking field inside it', async () => {
    const { fixture, root } = await render();
    removeAnywhere(root);
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', 'BGY');
    const earliest = root.querySelector<HTMLInputElement>('input[formControlName="from"]')!;
    earliest.value = '2026-12-01';
    earliest.dispatchEvent(new Event('input'));
    const workStart = root.querySelector<HTMLInputElement>('input[formControlName="workStart"]')!;
    expect(panel(root, 'leave-panel').hidden).toBe(true);
    workStart.value = '';
    workStart.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(panel(root, 'leave-panel').hidden).toBe(false);
    expect(panel(root, 'leave-panel').hasAttribute('inert')).toBe(false);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Enter your work start time.',
    );
  });
});
