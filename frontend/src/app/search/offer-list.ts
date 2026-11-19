import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Texts, money, plural } from '../i18n/texts';
import { Translated } from '../i18n/translated';
import { DestinationGroupList } from './destination-group-list';
import { DestinationGroup } from './destination-groups';
import { OfferItem } from './offer';
import { OfferView } from './offer-view';
import { enterIndex, pagedBy } from './paging';
import { SortOrder } from './search-api';

/** The heading, sort and offers of a search's results, shown 20 at a time. */
@Component({
  selector: 'app-offer-list',
  // Its offers show a price age that follows the clock.
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [ReactiveFormsModule, OfferItem, DestinationGroupList],
  host: { '[attr.data-stagger]': 'staggering() ? "" : null' },
  styleUrls: ['./offer-list.css', '../ui/pill-toggle.css'],
  templateUrl: './offer-list.html',
})
export class OfferList extends Translated {
  /** Offers in the order to show them. */
  readonly offers = input.required<OfferView[]>();
  /** The offers in destination groups, shown instead of a flat list; undefined for a flat list. */
  readonly groups = input<DestinationGroup[]>();
  /** Changes when the list should start again from the first page: a new search or sort. */
  readonly pageKey = input<unknown>();
  readonly sort = input.required<FormControl<SortOrder>>();
  readonly showSort = input(true);
  /** Whether the offers come from a new search: only then do the first ones stagger in. */
  readonly stagger = input(false);
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  protected readonly page = pagedBy(this.pageKey);
  /** Whether the list is marked for the stagger: a page added by "show more" ends it. */
  protected readonly staggering = linkedSignal(() => {
    this.pageKey();
    return this.stagger();
  });

  protected readonly enterIndex = enterIndex;

  protected showMore() {
    this.page.showMore();
    this.staggering.set(false);
  }

  protected visibleOffers() {
    return this.offers().slice(0, this.page.shown());
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
      groups: plural(texts, 'results.destinationGroups', groups.length),
      price: money(texts, cheapest, { whole: true }),
    });
  }
}
