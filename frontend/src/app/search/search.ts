import { catalogueName } from './catalogue-names';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  FormGroup,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { TranslocoService } from '@jsverse/transloco';
import { map, merge, switchMap } from 'rxjs';
import { Language, textsIn } from '../i18n/language';
import { ago, plural } from '../i18n/texts';
import { readTypedNames } from './typed-names';
import { InfoTip } from '../ui/info-tip';
import { offerView } from './offer-view';
import { Catalogue, Offer, OfferKind, SearchResponse, SortOrder, sortOrders } from './search-api';
import { filtersForm } from './search-filters';
import { loadSearchSettings, saveSearchSettings } from './search-settings';
import {
  buildSearchQuery,
  DateMode,
  DepartureDays,
  departureDaysWithoutChoice,
  SearchFormValue,
  sortOffers,
  windowWeekdays,
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

/** A search form with departure days of which no possible one is ticked. */
function noDepartureDay(form: AbstractControl): ValidationErrors | null {
  const missing = departureDaysWithoutChoice((form as FormGroup).getRawValue() as SearchFormValue);
  return missing.length > 0 ? { noDepartureDay: missing } : null;
}

/** Fixed dates require an inbound departure no earlier than the outbound departure. */
function fixedDateOrder(form: AbstractControl): ValidationErrors | null {
  const v = (form as FormGroup).getRawValue() as SearchFormValue;
  return v.dateMode === 'fixed' && v.kind === 'roundTrip' && v.from && v.to && v.to < v.from
    ? { fixedDateOrder: true }
    : null;
}

/** Search form for round-trip (default) or one-way offers, and the list of offers it finds. */
@Component({
  selector: 'app-search',
  imports: [ReactiveFormsModule, InfoTip],
  styleUrls: ['./search.css', './search-filters.css', './search-results.css'],
  templateUrl: './search.html',
})
export class Search {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly transloco = inject(TranslocoService);

  /** Airports, cities and countries to resolve typed names against; undefined until loaded. */
  private readonly catalogue = signal<Catalogue | undefined>(undefined);

  protected readonly form = this.fb.group(
    {
      kind: this.fb.control<OfferKind>('roundTrip'),
      dateMode: this.fb.control<DateMode>('flexible'),
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
        ignoreLeave: false,
        workStart: [defaultWorkStart, Validators.required],
        workEnd: [defaultWorkEnd, Validators.required],
        maxLeaveDays: this.fb.control<number | null>(null, Validators.pattern(/^\d+$/)),
      }),
      sort: this.fb.control<SortOrder>('price'),
      filters: filtersForm(this.fb),
    },
    { validators: [noDepartureDay, fixedDateOrder] },
  );
  protected readonly moments = moments;
  protected readonly weekdays = weekdays;

  /** The interface language, once its texts have loaded. */
  private readonly language = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((language) =>
        this.transloco.selectTranslation(language).pipe(map(() => language as Language)),
      ),
    ),
  );
  /** Texts and formats of the interface language; undefined until its texts have loaded. */
  private readonly texts = computed(() => {
    const language = this.language();
    return language ? textsIn(this.transloco, language) : undefined;
  });
  protected readonly priceAge = (fetchedAt: string) => {
    const texts = this.texts();
    return texts ? ago(texts, fetchedAt, Date.now()) : '';
  };

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  protected readonly ignoreLeave = toSignal(
    this.form.controls.leave.controls.ignoreLeave.valueChanges,
    {
      initialValue: this.form.controls.leave.controls.ignoreLeave.value,
    },
  );

  protected readonly dateMode = toSignal(this.form.controls.dateMode.valueChanges, {
    initialValue: this.form.controls.dateMode.value,
  });

  /** Offers of the last search and when they arrived; undefined before the first search. */
  private readonly found = signal<{ offers: Offer[]; at: number } | undefined>(undefined);
  private readonly sort = toSignal(this.form.controls.sort.valueChanges, {
    initialValue: this.form.controls.sort.value,
  });
  /**
   * Offers of the last search in the chosen order, shown in the interface language; undefined
   * before the first search. Switching the sort reorders them at once.
   */
  protected readonly offers = computed(() => {
    const found = this.found();
    const texts = this.texts();
    return found && texts
      ? sortOffers(found.offers, this.sort()).map((o) =>
          offerView(o, found.at, texts, this.catalogue()),
        )
      : undefined;
  });
  protected readonly visibleCount = signal(20);
  protected readonly visibleOffers = computed(() => this.offers()?.slice(0, this.visibleCount()));

  protected showMore() {
    this.visibleCount.update((count) => count + 20);
  }

  protected readonly loading = signal(false);
  /** The translation key of the last search's failure. */
  protected readonly error = signal<string | undefined>(undefined);
  /** Whether the user has tried to search; invalid fields are marked only after that. */
  protected readonly submitted = signal(false);

  constructor() {
    this.form.controls.sort.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.visibleCount.set(20));
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
    merge(this.form.controls.kind.valueChanges, this.form.controls.dateMode.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateApplicableFields());
    this.form.controls.leave.controls.ignoreLeave.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateLeaveLimit());
    merge(this.form.controls.from.valueChanges, this.form.controls.to.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.greyOutImpossibleDays());
    const settings = loadSearchSettings();
    if (settings) this.form.patchValue(settings);
    // Departure days used to be all unticked for "any day"; now every ticked day suits.
    for (const days of this.departureDays()) {
      if (Object.values(days.getRawValue()).every((ticked) => !ticked))
        days.setValue({
          mon: true,
          tue: true,
          wed: true,
          thu: true,
          fri: true,
          sat: true,
          sun: true,
        });
    }
    this.updateApplicableFields();
    // A sort remembered before it was removed (e.g. price per night) falls back to price.
    if (!(sortOrders as readonly string[]).includes(this.form.controls.sort.value)) {
      this.form.controls.sort.setValue('price');
    }
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
        this.visibleCount.set(20);
        this.found.set({ offers: resp.offers, at: Date.now() });
        this.loading.set(false);
      },
      error: () => {
        this.error.set('search.failed');
        this.loading.set(false);
      },
    });
  }

  /** The text under `key` in the interface language; empty until the language's texts have loaded. */
  protected t(key: string, params?: Record<string, unknown>): string {
    return this.texts()?.t(key, params) ?? '';
  }

  /** The heading of the results, like "3 offers" or "5 ofert". */
  protected offerCount(count: number): string {
    const texts = this.texts();
    return texts ? plural(texts, 'results.count', count) : '';
  }

  private updateApplicableFields() {
    const { kind, dateMode } = this.form.controls;
    for (const path of [...roundTripOnlyFields, 'to', 'filters.outboundDepartureWeekdays']) {
      if (fieldApplies(path, kind.value, dateMode.value)) this.form.get(path)?.enable();
      else this.form.get(path)?.disable();
    }
    this.updateLeaveLimit();
    this.greyOutImpossibleDays();
  }

  protected invalidFixedDates(): boolean {
    return this.submitted() && !!this.form.errors?.['fixedDateOrder'];
  }

  /** The departure-day groups of the filters. */
  private departureDays() {
    const { outboundDepartureWeekdays, inboundDepartureWeekdays } =
      this.form.controls.filters.controls;
    return [outboundDepartureWeekdays, inboundDepartureWeekdays];
  }

  /** An ignored leave limit keeps its value but cannot invalidate the search. */
  private updateLeaveLimit() {
    const leave = this.form.controls.leave.controls;
    if (this.form.controls.kind.value === 'roundTrip' && !leave.ignoreLeave.value)
      leave.maxLeaveDays.enable({ emitEvent: false });
    else leave.maxLeaveDays.disable({ emitEvent: false });
  }

  /**
   * Disables the departure days the travel window does not contain; a disabled day keeps its tick
   * for when the window covers it again. Days that do not apply to the kind of offer stay disabled.
   */
  private greyOutImpossibleDays() {
    const possible = windowWeekdays(this.form.controls.from.value, this.form.controls.to.value);
    const kind = this.form.controls.kind.value;
    for (const [name, days] of [
      ['outboundDepartureWeekdays', this.departureDays()[0]],
      ['inboundDepartureWeekdays', this.departureDays()[1]],
    ] as const) {
      if (!fieldApplies(`filters.${name}`, kind, this.form.controls.dateMode.value)) continue;
      for (const day of weekdays) {
        const control = days.controls[day.value];
        if (possible.has(day.value)) control.enable({ emitEvent: false });
        else control.disable({ emitEvent: false });
      }
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  /** Whether the departure days named should be marked invalid: no possible day is ticked, and the user has tried to search. */
  protected noDayLeft(name: DepartureDays): boolean {
    const missing = this.form.errors?.['noDepartureDay'] as DepartureDays[] | undefined;
    return this.submitted() && !!missing?.includes(name);
  }

  /** Whether a field outside the filters is invalid. */
  protected fieldsInvalid(): boolean {
    const { filters, ...fields } = this.form.controls;
    return Object.values(fields).some((control) => control.invalid);
  }

  /** Whether the form field named by its control path applies to the chosen kind of offer. */
  protected applies(path: string): boolean {
    return fieldApplies(path, this.kind(), this.dateMode());
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
      .map((a) => `${a.code} (${catalogueName(a, this.language() ?? 'en')})`)
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
    return (
      this.submitted() &&
      (!!this.form.get(path)?.invalid || (path === 'to' && this.invalidFixedDates()))
    );
  }
}
