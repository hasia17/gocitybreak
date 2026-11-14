import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import en from '../../../public/i18n/en.json';
import { textsIn } from '../i18n/language';
import { provideTestI18n } from '../i18n/testing';
import { OfferItem } from './offer';
import { offerView } from './offer-view';
import { Offer } from './search-api';

const offer: Offer = {
  kind: 'oneWay',
  outbound: {
    isDirect: true,
    flights: [
      {
        departureAirport: 'KRK',
        arrivalAirport: 'BGY',
        departure: { date: '2026-12-04', time: '06:40', timeZone: 'Europe/Warsaw' },
        arrival: { date: '2026-12-04', time: '08:15', timeZone: 'Europe/Rome' },
        originalPrice: { amount: 100, currency: 'PLN' },
        fetchedAt: '2026-12-04T00:00:00Z',
      },
    ],
  },
  price: { amount: 100, currency: 'PLN', approximate: false },
  priceFetchedAt: '2026-12-04T00:00:00Z',
};

@Component({
  imports: [OfferItem],
  template: `<ul>
    <li app-offer [offer]="view" [texts]="texts" [showDestination]="showDestination()"></li>
  </ul>`,
})
class Host {
  texts = textsIn(TestBed.inject(TranslocoService), 'en');
  view = offerView(offer, Date.parse('2026-12-04T12:00:00Z'), this.texts);
  showDestination = signal(true);
}

describe('OfferItem', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTestI18n()] });
    TestBed.inject(TranslocoService).setTranslation(en, 'en');
  });

  it('shows a leg on one line, with its route unless the destination is omitted', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const text = () => root.querySelector('.flight')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(text()).toBe('Fri 4 Dec, 06:40 → 08:15 KRK → BGY');

    fixture.componentInstance.showDestination.set(false);
    fixture.detectChanges();
    expect(text()).toBe('Fri 4 Dec, 06:40 → 08:15');
  });
});
