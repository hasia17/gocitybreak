import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Texts, plural } from '../i18n/texts';
import { OfferItem } from './offer';
import { OfferView } from './offer-view';
import { SortOrder } from './search-api';

const pageSize = 20;

/** The heading, sort and offers of a search's results, shown 20 at a time. */
@Component({
  selector: 'app-offer-list',
  // Its offers show a price age that follows the clock.
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [ReactiveFormsModule, OfferItem],
  styleUrl: './offer-list.css',
  templateUrl: './offer-list.html',
})
export class OfferList {
  /** Offers in the order to show them. */
  readonly offers = input.required<OfferView[]>();
  /** Changes when the list should start again from the first page: a new search or sort. */
  readonly pageKey = input<unknown>();
  readonly sort = input.required<FormControl<SortOrder>>();
  readonly showSort = input(true);
  /** The message for a search that found nothing. */
  readonly emptyText = input('');
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  protected readonly visibleCount = linkedSignal(() => {
    this.pageKey();
    return pageSize;
  });

  protected visibleOffers() {
    return this.offers().slice(0, this.visibleCount());
  }

  protected showMore() {
    this.visibleCount.update((count) => count + pageSize);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.texts()?.t(key, params) ?? '';
  }

  /** The heading of the results, like "3 offers" or "5 ofert". */
  protected offerCount(count: number): string {
    const texts = this.texts();
    return texts ? plural(texts, 'results.count', count) : '';
  }
}
