import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Flight, Money, Offer, SearchQuery, SearchResponse } from './search-api';

const airportCode = [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)];

const thisYear = new Date().getFullYear();
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** Search form for one-way offers and the list of offers it finds. */
@Component({
  selector: 'app-search',
  imports: [ReactiveFormsModule],
  styleUrl: './search.css',
  templateUrl: './search.html',
})
export class Search {
  private readonly http = inject(HttpClient);

  protected readonly form = inject(NonNullableFormBuilder).group({
    homeAirport: ['', airportCode],
    destinationAirport: ['', airportCode],
    from: ['', Validators.required],
    to: ['', Validators.required],
  });

  /** Offers of the last search; undefined before the first search. */
  protected readonly offers = signal<Offer[] | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  /** Whether the user has tried to search; invalid fields are marked only after that. */
  protected readonly submitted = signal(false);

  protected submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const query: SearchQuery = {
      kind: 'oneWay',
      homeAirports: [v.homeAirport.toUpperCase()],
      destination: { airports: [v.destinationAirport.toUpperCase()] },
      travelWindow: { from: v.from, to: v.to },
    };
    this.loading.set(true);
    this.error.set(undefined);
    this.http.post<SearchResponse>('/api/search', query).subscribe({
      next: (resp) => {
        this.offers.set(resp.offers);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Search failed. Check the form and try again.');
        this.loading.set(false);
      },
    });
  }

  /** Whether a field should be marked invalid: it is, and the user has tried to search. */
  protected invalid(name: keyof typeof this.form.controls): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  /** A local date like "Sat 5 Dec", with the year added outside the current year. */
  protected day(date: string): string {
    const year = Number(date.slice(0, 4));
    const label = dayFormat.format(Date.parse(date));
    return year === thisYear ? label : `${label} ${year}`;
  }

  protected money(m: Money): string {
    return `${m.amount.toFixed(2)} ${m.currency}`;
  }

  /** How many days after its departure date the flight lands, in local dates; 0 for the same day. */
  protected daysLater(flight: Flight): number {
    return Math.round((Date.parse(flight.arrival.date) - Date.parse(flight.departure.date)) / 86_400_000);
  }

  /** Flights of the offer priced in a currency other than PLN, whose original amount is shown. */
  protected foreignPrices(offer: Offer): Money[] {
    return offer.outbound.flights.map((f) => f.originalPrice).filter((p) => p.currency !== 'PLN');
  }

  /** How long ago the offer's stored price was fetched, e.g. "3 h ago". */
  protected priceAge(offer: Offer): string {
    const minutes = Math.max(
      0,
      Math.round((Date.now() - Date.parse(offer.priceFetchedAt)) / 60_000),
    );
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }
}
