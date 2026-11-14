import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Texts, plural } from '../i18n/texts';
import { DestinationGroup } from './destination-groups';
import { OfferView } from './offer-view';

/** The results board of destination groups: one row per destination airport. */
@Component({
  selector: 'app-destination-group-list',
  // Its offers show a price age that follows the clock.
  changeDetection: ChangeDetectionStrategy.Eager,
  // A group row is one button: the spaces between its parts keep its accessible name readable.
  preserveWhitespaces: true,
  styleUrl: './destination-group-list.css',
  templateUrl: './destination-group-list.html',
})
export class DestinationGroupList {
  /** Groups in the order to show them. */
  readonly groups = input.required<DestinationGroup[]>();
  /** Changes when the board should start again from the first page, all closed: a new search or sort. */
  readonly pageKey = input<unknown>();
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  /** The days an offer leaves and comes back, like "pt 4 gru – nd 6 gru". */
  protected dates(offer: OfferView): string {
    return offer.legs.map((leg) => leg.flights[0].day).join(' – ');
  }

  protected count(key: string, count: number): string {
    const texts = this.texts();
    return texts ? plural(texts, key, count) : '';
  }
}
