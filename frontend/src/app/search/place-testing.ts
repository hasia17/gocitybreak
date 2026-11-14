import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Catalogue } from './search-api';

/** Shared HTTP catalogue fixture and user interaction for search DOM specs. */
export const testCatalogue: Catalogue = {
  supportedAirports: [
    { code: 'KRK', name: 'Kraków' },
    { code: 'KTW', name: 'Katowice' },
    { code: 'BGY', name: 'Milan Bergamo' },
  ],
  airports: [
    { code: 'KRK', name: 'Kraków', cities: ['KRAKOW'], country: 'pl' },
    { code: 'KTW', name: 'Katowice', cities: ['KATOWICE'], country: 'pl' },
    { code: 'BGY', name: 'Milan Bergamo', cities: ['BERGAMO', 'MILAN'], country: 'it' },
  ],
  cities: [
    { code: 'KRAKOW', name: 'Kraków', airports: ['KRK'], country: 'pl' },
    { code: 'KATOWICE', name: 'Katowice', airports: ['KTW'], country: 'pl' },
    { code: 'BERGAMO', name: 'Bergamo', airports: ['BGY'], country: 'it' },
    { code: 'MILAN', name: 'Milan', airports: ['BGY'], country: 'it' },
  ],
  countries: [
    { code: 'pl', name: 'Poland' },
    { code: 'it', name: 'Italy' },
  ],
};
export function flushCatalogue(): void {
  TestBed.inject(HttpTestingController)
    .match('/api/catalogue')
    .forEach((req) => req.flush(testCatalogue));
  TestBed.inject(ApplicationRef).tick();
}

/** The destination starts as Anywhere; remove it so that other places can be chosen. */
export function removeAnywhere(root: HTMLElement): void {
  root.querySelector('[data-place-chip="anywhere"] button')?.dispatchEvent(new MouseEvent('click'));
  TestBed.inject(ApplicationRef).tick();
}

/** Select each comma-separated known suggestion, keeping unmatched text unselected. */
export function fillPlace(root: HTMLElement, label: string, value: string): boolean {
  const input = Array.from(root.querySelectorAll<HTMLInputElement>('[role="combobox"]')).find(
    (i) => i.getAttribute('aria-label') === label,
  );
  if (!input) return false;
  flushCatalogue();
  // The destination starts as Anywhere, which excludes every other place until it is removed.
  const anywhere = input.closest('app-place-chips')!.querySelector('[data-place-chip="anywhere"]');
  if (anywhere && value.toLowerCase() === 'anywhere') return true;
  if (anywhere) removeAnywhere(input.closest('app-place-chips')!);
  for (const name of value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    input.value = name;
    input.dispatchEvent(new Event('input'));
    TestBed.inject(ApplicationRef).tick();
    const options = Array.from(
      input.closest('app-place-chips')!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    options[0]?.click();
    TestBed.inject(ApplicationRef).tick();
  }
  return true;
}
