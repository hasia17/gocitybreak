import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Texts, ago } from '../i18n/texts';
import { InfoTip } from '../ui/info-tip';
import { OfferView } from './offer-view';

/** One offer of the result list: its legs, badges, price and booking links. */
@Component({
  selector: 'li[app-offer]',
  // The price age follows the clock, so the offer is checked whenever its list is.
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [InfoTip],
  host: { class: 'offer', 'data-testid': 'offer' },
  styleUrl: './offer.css',
  templateUrl: './offer.html',
})
export class OfferItem {
  readonly offer = input.required<OfferView>();
  /** False inside a group that names the destination: a single-flight leg then drops its route. */
  readonly showDestination = input(true);
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();

  /** Not a computed value: the age grows with the clock, not with the inputs. */
  protected priceAge(): string {
    const texts = this.texts();
    return texts ? ago(texts, this.offer().priceFetchedAt, Date.now()) : '';
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.texts()?.t(key, params) ?? '';
  }
}
