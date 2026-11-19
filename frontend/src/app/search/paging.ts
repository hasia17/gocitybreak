import { linkedSignal, Signal } from '@angular/core';

const pageSize = 20;

/** Entering offers stagger over their first few; later ones enter with the last of those. */
const staggerSteps = 8;

/** How many items of a list are shown, 20 at a time; it starts again at one page when `key` changes. */
export function pagedBy(key: Signal<unknown>) {
  const shown = linkedSignal(() => {
    key();
    return pageSize;
  });
  return { shown, showMore: () => shown.update((count) => count + pageSize) };
}

/**
 * The place of an item in the stagger of a new search's first page; null past it, so the items
 * that showing more adds enter at once.
 */
export function enterIndex(index: number): number | null {
  return addedByShowMore(index) ? null : Math.min(index, staggerSteps - 1);
}

/** Whether an item is past the first page, so "show more" added it: such items fade in together. */
export function addedByShowMore(index: number): boolean {
  return index >= pageSize;
}
