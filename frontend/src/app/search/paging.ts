import { linkedSignal, Signal } from '@angular/core';

const pageSize = 20;

/** How many items of a list are shown, 20 at a time; it starts again at one page when `key` changes. */
export function pagedBy(key: Signal<unknown>) {
  const shown = linkedSignal(() => {
    key();
    return pageSize;
  });
  return { shown, showMore: () => shown.update((count) => count + pageSize) };
}
