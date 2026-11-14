import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { Texts, plural } from '../i18n/texts';
import { Translated } from '../i18n/translated';
import { DestinationGroup } from './destination-groups';
import { OfferItem } from './offer';
import { OfferView } from './offer-view';
import { pagedBy } from './paging';

/** Offers an open group shows before "Show all". */
const offersPerGroup = 5;

/** The results board of destination groups: one row per destination airport. */
@Component({
  selector: 'app-destination-group-list',
  // Its offers show a price age that follows the clock.
  changeDetection: ChangeDetectionStrategy.Eager,
  // A group row is one button: the spaces between its parts keep its accessible name readable.
  preserveWhitespaces: true,
  imports: [OfferItem],
  styleUrl: './destination-group-list.css',
  templateUrl: './destination-group-list.html',
})
export class DestinationGroupList extends Translated {
  /** Groups in the order to show them. */
  readonly groups = input.required<DestinationGroup[]>();
  /** Changes when the board should start again from the first page, all closed: a new search or sort. */
  readonly pageKey = input<unknown>();
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  protected readonly page = pagedBy(this.pageKey);
  protected readonly visibleGroups = computed(() => this.groups().slice(0, this.page.shown()));

  /** Airports of the open groups; any number may be open. */
  protected readonly open = linkedSignal<unknown, ReadonlySet<string>>({
    source: this.pageKey,
    computation: () => new Set(),
  });
  /** Airports of the groups showing all their offers, not just the first few. */
  protected readonly showingAll = linkedSignal<unknown, ReadonlySet<string>>({
    source: this.pageKey,
    computation: () => new Set(),
  });

  protected toggle(airport: string) {
    this.open.update((open) => toggled(open, airport));
  }

  protected showAll(airport: string) {
    this.showingAll.update((all) => new Set(all).add(airport));
  }

  /** The offers an open group shows: its first few, or all of them on demand. */
  protected shownOffers(group: DestinationGroup): OfferView[] {
    return this.showingAll().has(group.airport)
      ? group.offers
      : group.offers.slice(0, offersPerGroup);
  }

  protected count(key: string, count: number): string {
    const texts = this.texts();
    return texts ? plural(texts, key, count) : '';
  }
}

function toggled(set: ReadonlySet<string>, item: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}
