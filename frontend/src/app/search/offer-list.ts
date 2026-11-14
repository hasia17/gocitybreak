import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Texts, money, plural } from '../i18n/texts';
import { DestinationGroupList } from './destination-group-list';
import { DestinationGroup } from './destination-groups';
import { OfferItem } from './offer';
import { OfferView } from './offer-view';
import { SortOrder } from './search-api';

const pageSize = 20;

/** The heading, sort and offers of a search's results, shown 20 at a time. */
@Component({
  selector: 'app-offer-list',
  // Its offers show a price age that follows the clock.
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [ReactiveFormsModule, OfferItem, DestinationGroupList],
  styleUrl: './offer-list.css',
  templateUrl: './offer-list.html',
})
export class OfferList {
  /** Offers in the order to show them. */
  readonly offers = input.required<OfferView[]>();
  /** The offers in destination groups, shown instead of a flat list; undefined for a flat list. */
  readonly groups = input<DestinationGroup[]>();
  /** Changes when the list should start again from the first page: a new search or sort. */
  readonly pageKey = input<unknown>();
  readonly sort = input.required<FormControl<SortOrder>>();
  readonly showSort = input(true);
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

  /**
   * The heading of the results, like "3 offers" or "5 ofert"; for destination groups also their
   * number and the lowest price, like "3219 ofert w 67 miejscach, od 157 zł".
   */
  protected heading(): string {
    const texts = this.texts();
    if (!texts) return '';
    const offers = plural(texts, 'results.count', this.offers().length);
    const groups = this.groups();
    if (!groups) return offers;
    const cheapest = groups
      .map((g) => g.cheapest)
      .reduce((low, price) => (price.amount < low.amount ? price : low));
    return texts.t('results.grouped', {
      offers,
      places: plural(texts, 'results.places', groups.length),
      // "From" already says the price is a bound; the approximate mark is left to the offers.
      price: money(
        texts,
        { amount: cheapest.amount, currency: cheapest.currency },
        { whole: true },
      ),
    });
  }
}
