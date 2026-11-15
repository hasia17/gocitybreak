import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Texts, ago } from '../i18n/texts';
import { Translated } from '../i18n/translated';
import { InfoTip } from '../ui/info-tip';
import { OfferView } from './offer-view';
import { PriceStamp } from './price-stamp';

/** One offer of the result list: its legs, badges, price and booking links. */
@Component({
  selector: 'li[app-offer]',
  // The price age follows the clock, so the offer is checked whenever its list is.
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [InfoTip, PriceStamp],
  host: { class: 'offer', 'data-testid': 'offer' },
  styleUrl: './offer.css',
  templateUrl: './offer.html',
})
export class OfferItem extends Translated {
  readonly offer = input.required<OfferView>();
  /** False inside a group that names the destination: a single-flight leg then drops its route. */
  readonly showDestination = input(true);
  /** False inside a group, whose row already stamps its best price: the offer then prices plainly. */
  readonly stamped = input(true);
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  /** Not a computed value: the age grows with the clock, not with the inputs. */
  protected priceAge(): string {
    const texts = this.texts();
    return texts ? ago(texts, this.offer().priceFetchedAt, Date.now()) : '';
  }
}
