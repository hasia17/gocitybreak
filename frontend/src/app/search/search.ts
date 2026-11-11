import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { readTypedNames } from './typed-names';
import { OfferView, offerView, priceAge } from './offer-view';
import { Catalogue, OfferKind, SearchResponse, SortOrder } from './search-api';
import { filtersForm } from './search-filters';
import { loadSearchSettings, saveSearchSettings } from './search-settings';
import {
  buildSearchQuery,
  defaultWorkEnd,
  defaultWorkStart,
  fieldApplies,
  moments,
  roundTripOnlyFields,
  typedCodes,
  weekdays,
} from './search-query';

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

/** Search form for round-trip (default) or one-way offers, and the list of offers it finds. */
@Component({
  selector: 'app-search',
  imports: [ReactiveFormsModule],
  styleUrls: ['./search.css', './search-filters.css', './search-results.css'],
  templateUrl: './search.html',
})
export class Search {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);

  /** Airports, cities and countries to resolve typed names against; undefined until loaded. */
  private readonly catalogue = signal<Catalogue | undefined>(undefined);

  protected readonly form = this.fb.group({
    kind: this.fb.control<OfferKind>('roundTrip'),
    homeAirports: ['', [...airportCodes, this.supportedAirports()]],
    destination: ['', this.knownNames('destination')],
    exclusions: ['', this.knownNames('exclusions')],
    from: ['', Validators.required],
    to: ['', Validators.required],
    stayLength: this.fb.group(
      { min: [2, nightCount], max: [3, nightCount] },
      { validators: maxBelowMin },
    ),
    leave: this.fb.group({
      workStart: [defaultWorkStart, Validators.required],
      workEnd: [defaultWorkEnd, Validators.required],
      maxLeaveDays: this.fb.control<number | null>(null, Validators.pattern(/^\d+$/)),
    }),
    sort: this.fb.control<SortOrder>('price'),
    filters: filtersForm(this.fb),
  });
  protected readonly moments = moments;
  protected readonly weekdays = weekdays;
  protected readonly priceAge = (fetchedAt: string) => priceAge(fetchedAt, Date.now());

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });

  /** Offers of the last search; undefined before the first search. */
  protected readonly offers = signal<OfferView[] | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  /** Whether the user has tried to search; invalid fields are marked only after that. */
  protected readonly submitted = signal(false);

  constructor() {
    // Typed home airports, destination and exclusions are checked again once the catalogue arrives.
    // Without it, any airport code is taken and the backend checks home airports.
    this.http
      .get<Catalogue>('/api/catalogue')
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (catalogue) => {
          this.catalogue.set(catalogue);
          this.form.controls.homeAirports.updateValueAndValidity();
          this.form.controls.destination.updateValueAndValidity();
          this.form.controls.exclusions.updateValueAndValidity();
        },
        error: () => {},
      });
    // Fields that do not apply to the kind of offer are disabled: a disabled control does not
    // affect the form's validity, and the raw value keeps it so remembered settings lose nothing.
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
      for (const path of roundTripOnlyFields) {
        if (fieldApplies(path, kind)) this.form.get(path)?.enable();
        else this.form.get(path)?.disable();
      }
    });
    const settings = loadSearchSettings();
    if (settings) this.form.patchValue(settings);
  }

  protected submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    saveSearchSettings(v);
    this.loading.set(true);
    this.error.set(undefined);
    this.http.post<SearchResponse>('/api/search', buildSearchQuery(v, this.catalogue())).subscribe({
      next: (resp) => {
        const now = Date.now();
        this.offers.set(resp.offers.map((offer) => offerView(offer, now)));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Search failed. Check the form and try again.');
        this.loading.set(false);
      },
    });
  }

  /** Whether the form field named by its control path applies to the chosen kind of offer. */
  protected applies(path: string): boolean {
    return fieldApplies(path, this.kind());
  }

  /** A validator of home airports: each must be a supported airport of the catalogue, once it is loaded. */
  private supportedAirports(): ValidatorFn {
    return (control) => {
      const supported = this.catalogue()?.supportedAirports;
      if (!supported) return null;
      const unsupported = typedCodes(control.value as string).filter(
        (code) => !supported.some((a) => a.code === code),
      );
      return unsupported.length > 0 ? { unsupportedAirport: unsupported } : null;
    };
  }

  /** The supported airports, like "KRK (Kraków), KTW (Katowice)". */
  protected supportedAirportList(): string {
    return (this.catalogue()?.supportedAirports ?? [])
      .map((a) => `${a.code} (${a.name})`)
      .join(', ');
  }

  /**
   * A validator of airports, cities and countries typed as text: each must name a known one; only a destination
   * may be anywhere, and a destination needs at least one name.
   */
  private knownNames(field: 'destination' | 'exclusions'): ValidatorFn {
    return (control) => {
      const typed = readTypedNames(control.value as string, this.catalogue());
      if (typed.unknown.length > 0) return { unknownName: typed.unknown };
      if (field === 'exclusions') return typed.anywhere ? { anywhereExcluded: true } : null;
      return typed.anywhere || Object.keys(typed.codes).length > 0 ? null : { required: true };
    };
  }

  /** Whether a field, named by its path like "leave.workStart", should be marked invalid: it is, and the user has tried to search. */
  protected invalid(path: string): boolean {
    return this.submitted() && !!this.form.get(path)?.invalid;
  }
}
