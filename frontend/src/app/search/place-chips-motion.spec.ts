import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue } from './place-testing';
import { Search } from './search';

useSearchClock();

/**
 * Suggestions and the further-places list drop down and close (#85, spec #79).
 * jsdom has no Element.getAnimations, so Angular's animate.enter / animate.leave do not run here:
 * the timing, the enter and exit classes and reduced motion are checked by hand in the browser.
 * These specs pin what the DOM does around them: the list is not rebuilt while typing (which
 * would replay its enter) and it is gone once it has left.
 */
describe('Place suggestions motion', () => {
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

  function fieldInput(root: HTMLElement, label: string): HTMLInputElement {
    return Array.from(root.querySelectorAll<HTMLInputElement>('[role="combobox"]')).find(
      (input) => input.getAttribute('aria-label') === label,
    )!;
  }

  function type(root: HTMLElement, label: string, text: string): void {
    const input = fieldInput(root, label);
    input.dispatchEvent(new Event('focus'));
    input.value = text;
    input.dispatchEvent(new Event('input'));
    TestBed.inject(ApplicationRef).tick();
  }

  it('changes the options of an open list without rebuilding the list', async () => {
    const { fixture, root } = await render();
    type(root, 'From', 'K');
    await fixture.whenStable();
    const listbox = root.querySelector('[role="listbox"]')!;
    const before = listbox.querySelectorAll('[role="option"]').length;

    type(root, 'From', 'Kra');
    await fixture.whenStable();

    expect(root.querySelector('[role="listbox"]')).toBe(listbox);
    expect(listbox.querySelectorAll('[role="option"]').length).not.toBe(before);
    expect(listbox.textContent).toContain('KRK');
  });

  it('removes the suggestions once they have left', async () => {
    const { fixture, root } = await render();
    type(root, 'From', 'Kr');
    await fixture.whenStable();
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();

    fieldInput(root, 'From').dispatchEvent(new Event('blur'));
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();

    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  it('shows the further-places list when opened and removes it when closed', async () => {
    const { fixture, root } = await render();
    fillPlace(root, 'From', 'KRK, KTW, BGY');
    await fixture.whenStable();
    const more = root.querySelector<HTMLButtonElement>('button.more')!;

    more.click();
    await fixture.whenStable();
    expect(root.querySelector('.chosen-list')).not.toBeNull();

    more.click();
    await fixture.whenStable();
    expect(root.querySelector('.chosen-list')).toBeNull();
  });
});
