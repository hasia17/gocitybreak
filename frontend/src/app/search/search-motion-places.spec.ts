import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fillPlace } from './place-testing';
import { renderSearch, useAnimatedSearch } from './search-testing';

/**
 * Chosen places enter their field and leave it while their space closes (spec #88).
 * jsdom has no Element.getAnimations, so the enter and leave themselves are checked by hand in the
 * browser; these specs pin what the DOM and focus do around them.
 */
describe('Chosen place motion', () => {
  useAnimatedSearch();

  function chip(root: HTMLElement, code: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(`[data-place-chip="${code}"]`);
  }

  function fromInput(root: HTMLElement): HTMLInputElement {
    return Array.from(root.querySelectorAll<HTMLInputElement>('[role="combobox"]')).find(
      (input) => input.getAttribute('aria-label') === 'From',
    )!;
  }

  it('removes a removed place once it has left, keeping its neighbour', async () => {
    const { fixture, root } = await renderSearch();
    fillPlace(root, 'From', 'KRK, KTW');
    await fixture.whenStable();
    expect(chip(root, 'KRK')).not.toBeNull();

    chip(root, 'KRK')!.querySelector('button')!.click();
    await fixture.whenStable();

    expect(chip(root, 'KRK')).toBeNull();
    expect(chip(root, 'KTW')).not.toBeNull();
  });

  it('leaves focus nowhere in the field after removing a place with its × button', async () => {
    const { fixture, root } = await renderSearch();
    document.body.appendChild(root);
    fillPlace(root, 'From', 'KRK, KTW');
    await fixture.whenStable();
    const remove = chip(root, 'KRK')!.querySelector('button')!;
    remove.focus();

    remove.click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(document.body);
  });

  it('keeps focus in the input after removing the last place with Backspace', async () => {
    const { fixture, root } = await renderSearch();
    document.body.appendChild(root);
    fillPlace(root, 'From', 'KRK, KTW');
    await fixture.whenStable();
    const input = fromInput(root);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();

    expect(chip(root, 'KTW')).toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
