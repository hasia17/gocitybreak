import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ryanairTickets } from './ryanair-booking';
import {
  Flight,
  Leg,
  Money,
  Offer,
  OfferKind,
  SearchQuery,
  SearchResponse,
  SortOrder,
} from './search-api';
import { loadSearchSettings, saveSearchSettings } from './search-settings';

const airportCode = [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)];
/** One or more airport codes separated by commas or spaces, e.g. "KRK, KTW". */
const airportCodes = [
  Validators.required,
  Validators.pattern(/^[\s,]*[A-Za-z]{3}(?:[\s,]+[A-Za-z]{3})*[\s,]*$/),
];
const nightCount = [Validators.required, Validators.pattern(/^\d+$/)];

/** A stay length whose maximum is below its minimum. */
function maxBelowMin(group: AbstractControl): ValidationErrors | null {
  const { min, max } = group.value as { min: number | null; max: number | null };
  return min != null && max != null && max < min ? { maxBelowMin: true } : null;
}

const thisYear = new Date().getFullYear();
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** Search form for round-trip (default) or one-way offers, and the list of offers it finds. */
@Component({
  selector: 'app-search',
  imports: [ReactiveFormsModule],
  styleUrl: './search.css',
  templateUrl: './search.html',
})
export class Search {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    kind: this.fb.control<OfferKind>('roundTrip'),
    homeAirports: ['', airportCodes],
    destinationAirport: ['', airportCode],
    from: ['', Validators.required],
    to: ['', Validators.required],
    stayLength: this.fb.group(
      { min: [2, nightCount], max: [3, nightCount] },
      { validators: maxBelowMin },
    ),
    leave: this.fb.group({
      workStart: ['09:00', Validators.required],
      workEnd: ['17:00', Validators.required],
      maxLeaveDays: this.fb.control<number | null>(null, Validators.pattern(/^\d+$/)),
      sort: this.fb.control<SortOrder>('price'),
    }),
  });

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });

  /** Offers of the last search; undefined before the first search. */
  protected readonly offers = signal<Offer[] | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  /** Whether the user has tried to search; invalid fields are marked only after that. */
  protected readonly submitted = signal(false);
  protected readonly ryanairTickets = ryanairTickets;

  constructor() {
    // The stay length applies to round trips only; a disabled group does not affect the form's validity.
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
      const stayLength = this.form.controls.stayLength;
      if (kind === 'roundTrip') stayLength.enable();
      else stayLength.disable();
    });
    // So do work hours, the maximum of leave days and the sort, which has only price for one-way offers.
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
      const leave = this.form.controls.leave;
      if (kind === 'roundTrip') leave.enable();
      else leave.disable();
    });
    const settings = loadSearchSettings();
    if (settings) this.form.patchValue(settings);
  }

  protected submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    saveSearchSettings(v);
    const query: SearchQuery = {
      kind: v.kind,
      homeAirports: [
        ...new Set(
          v.homeAirports
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((code) => code.toUpperCase()),
        ),
      ],
      destination: { airports: [v.destinationAirport.toUpperCase()] },
      travelWindow: { from: v.from, to: v.to },
    };
    if (v.kind === 'roundTrip') {
      query.stayLength = { min: Number(v.stayLength.min), max: Number(v.stayLength.max) };
      query.workStart = v.leave.workStart;
      query.workEnd = v.leave.workEnd;
      if (v.leave.maxLeaveDays != null) query.maxLeaveDays = Number(v.leave.maxLeaveDays);
      query.sort = v.leave.sort;
    }
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

  /** Whether a work-hours or leave-days field should be marked invalid, like `invalid`. */
  protected invalidLeave(name: keyof typeof this.form.controls.leave.controls): boolean {
    return this.submitted() && this.form.controls.leave.controls[name].invalid;
  }

  /** Leave days like "no leave days", "1 leave day" or "2 leave days". */
  protected leaveDays(days: number): string {
    if (days === 0) return 'no leave days';
    return `${days} ${days === 1 ? 'leave day' : 'leave days'}`;
  }

  /** The offer's legs in travel order: outbound, then inbound for a round trip. */
  protected legs(offer: Offer): Leg[] {
    return offer.inbound ? [offer.outbound, offer.inbound] : [offer.outbound];
  }

  /** A local date like "Sat 5 Dec", with the year added outside the current year. */
  protected day(date: string): string {
    const year = Number(date.slice(0, 4));
    const label = dayFormat.format(Date.parse(date));
    return year === thisYear ? label : `${label} ${year}`;
  }

  /** A small count in words, e.g. "two"; numerals from 10 on. */
  protected count(n: number): string {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    return words[n] ?? `${n}`;
  }

  protected money(m: Money): string {
    return `${m.amount.toFixed(2)} ${m.currency}`;
  }

  /** How many days after its departure date the flight lands, in local dates; 0 for the same day. */
  protected daysLater(flight: Flight): number {
    return Math.round(
      (Date.parse(flight.arrival.date) - Date.parse(flight.departure.date)) / 86_400_000,
    );
  }

  /** Flights of the offer priced in a currency other than PLN, whose original amount is shown. */
  protected foreignPrices(offer: Offer): Money[] {
    return this.legs(offer)
      .flatMap((leg) => leg.flights)
      .map((f) => f.originalPrice)
      .filter((p) => p.currency !== 'PLN');
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
