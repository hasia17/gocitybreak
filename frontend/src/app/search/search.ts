import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  FormGroup,
  Validators,
} from '@angular/forms';
import { TranslocoService } from '@jsverse/transloco';
import { combineLatest, map, merge, switchMap, take } from 'rxjs';
import { Language, textsIn } from '../i18n/language';
import { plural } from '../i18n/texts';
import { PlaceChips } from './place-chips';
import { PlaceTranslations } from './place-translations';
import { restorePlaces } from './place-suggestions';
import { InfoTip } from '../ui/info-tip';
import { OfferList } from './offer-list';
import { NoOffersMessage } from './no-offers-message';
import { describeNoOffers, SuggestionId } from './no-offers';
import { ResultsSkeleton } from './results-skeleton';
import { SearchSummary, summarySearch } from './search-summary';
import { offerView } from './offer-view';
import { coversSeveralAirports, destinationGroups } from './destination-groups';
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
  weekdays,
} from './search-query';

const nightCount = [Validators.required, Validators.pattern(/^\d+$/)];
const workTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const workHours = [Validators.required, Validators.pattern(workTime)];

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

/** The browser's local calendar date, `days` days from today, as an ISO date. */
function localIsoDate(days: number): string {
  const now = new Date(Date.now());
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The travel window a new search starts with: tomorrow to eight weeks from today. */
function defaultTravelWindow(): { from: string; to: string } {
  return { from: localIsoDate(1), to: localIsoDate(56) };
}

/** Compare ISO dates with the browser's local calendar, rather than the UTC date. */
function pastDate(control: AbstractControl): ValidationErrors | null {
  const today = localIsoDate(0);
  return control.value && control.value < today ? { pastDate: true } : null;
}

/** The latest flexible date cannot precede the earliest date, for either kind of offer. */
function dateOrder(form: AbstractControl): ValidationErrors | null {
  const v = (form as FormGroup).getRawValue() as SearchFormValue;
  return v.dateMode === 'flexible' && v.from && v.to && v.to < v.from ? { dateOrder: true } : null;
}

/** Map the English API reasons to interface keys; unknown reasons never reach the page. */
function rejectedSearchMessage(reason: string): string {
  if (reason === 'travelWindow.to must not be before travelWindow.from')
    return 'search.errors.dateOrder';
  if (reason === 'fixedDates.inbound must not be before fixedDates.outbound')
    return 'search.hint.fixedDateOrder';
  const categories: [RegExp, string][] = [
    [/^(homeAirports\b|home airport .* is not a supported airport$)/, 'homeAirports'],
    [/^destination\b/, 'destination'],
    [
      /^(travelWindow\.|fixedDates\.|exactly one of travelWindow or fixedDates is required$)/,
      'dates',
    ],
    [/^stayLength\b/, 'stayLength'],
    [/^(workStart|workEnd)\b/, 'workHours'],
    [/^filters\.(outbound|inbound)(Departure|Arrival)\./, 'timeRanges'],
    [/^filters\.(outbound|inbound)DepartureWeekdays\b/, 'weekdays'],
    [/^maxLeaveDays\b/, 'leaveLimit'],
    [/^sort\b/, 'sort'],
    [/^kind\b/, 'kind'],
  ];
  return `search.errors.${categories.find(([pattern]) => pattern.test(reason))?.[1] ?? 'rejected'}`;
}

/** Search form for round-trip (default) or one-way offers, and the list of offers it finds. */
@Component({
  selector: 'app-search',
  imports: [
    ReactiveFormsModule,
    InfoTip,
    PlaceChips,
    OfferList,
    SearchSummary,
    NoOffersMessage,
    ResultsSkeleton,
  ],
  styleUrls: ['./search.css', './search-filters.css', './search-results.css'],
  templateUrl: './search.html',
})
export class Search {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);
  private readonly placeTranslations = inject(PlaceTranslations);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The only source of selectable airports, cities and countries; undefined until loaded. */
  protected readonly catalogue = signal<Catalogue | undefined>(undefined);
  protected readonly catalogueStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

  protected readonly form = this.fb.group(
    {
      kind: this.fb.control<OfferKind>('roundTrip'),
      dateMode: this.fb.control<DateMode>('flexible'),
      homeAirports: ['', Validators.required],
      destination: ['anywhere', Validators.required],
      exclusions: [''],
      from: [defaultTravelWindow().from, [Validators.required, pastDate]],
      to: [defaultTravelWindow().to, [Validators.required, pastDate]],
      stayLength: this.fb.group(
        { min: [2, nightCount], max: [3, nightCount] },
        { validators: maxBelowMin },
      ),
      leave: this.fb.group({
        ignoreLeave: false,
        workStart: [defaultWorkStart, workHours],
        workEnd: [defaultWorkEnd, workHours],
        maxLeaveDays: this.fb.control<number | null>(null, Validators.pattern(/^\d+$/)),
      }),
      sort: this.fb.control<SortOrder>('price'),
      filters: filtersForm(this.fb),
    },
    { validators: [noDepartureDay, fixedDateOrder, dateOrder] },
  );
  protected readonly places = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  private readonly lastWorkHours = { workStart: defaultWorkStart, workEnd: defaultWorkEnd };
  protected readonly moments = moments;
  protected readonly weekdays = weekdays;

  /** The interface language, once its texts have loaded. */
  protected readonly language = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((language) =>
        this.transloco.selectTranslation(language).pipe(map(() => language as Language)),
      ),
    ),
  );
  /** Texts and formats of the interface language; undefined until its texts have loaded. */
  protected readonly texts = computed(() => {
    const language = this.language();
    return language ? textsIn(this.transloco, language) : undefined;
  });

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  protected readonly ignoreLeave = toSignal(
    this.form.controls.leave.controls.ignoreLeave.valueChanges,
    {
      initialValue: this.form.controls.leave.controls.ignoreLeave.value,
    },
  );

  private readonly leave = toSignal(this.form.controls.leave.valueChanges, {
    initialValue: this.form.controls.leave.getRawValue(),
  });
  /** Whether the Leave and Filters sections of the form are open; both start collapsed. */
  protected readonly leaveOpen = signal(false);
  protected readonly filtersOpen = signal(false);

  /** One line on the collapsed Leave section: the work hours and the leave limit, or the switch. */
  protected readonly leaveSummary = computed(() => {
    const texts = this.texts();
    // The group's value omits disabled controls, so read the raw one to follow every change.
    const leave = (this.leave(), this.form.controls.leave.getRawValue());
    if (!texts) return '';
    if (leave.ignoreLeave) return texts.t('search.ignoreLeave');
    const hours = (value: string, last: string) =>
      (workTime.test(value) ? value : last).replace(/^0/, '');
    const params = {
      start: hours(leave.workStart, this.lastWorkHours.workStart),
      end: hours(leave.workEnd, this.lastWorkHours.workEnd),
    };
    const limit = leave.maxLeaveDays;
    return typeof limit === 'number' && Number.isInteger(limit) && limit >= 0
      ? plural(texts, 'search.leaveSummary.limited', limit, params)
      : texts.t('search.leaveSummary.unlimited', params);
  });

  protected readonly dateMode = toSignal(this.form.controls.dateMode.valueChanges, {
    initialValue: this.form.controls.dateMode.value,
  });

  /** Offers of the last search and when they arrived; undefined before the first search. */
  private readonly found = signal<{ offers: Offer[]; at: number } | undefined>(undefined);
  private readonly sort = toSignal(this.form.controls.sort.valueChanges, {
    initialValue: this.form.controls.sort.value,
  });
  /** Changes with a new search or sort, not with the language: the list then starts at page one. */
  protected readonly pageKey = computed(() => ({ found: this.found(), sort: this.sort() }));
  /**
   * Destination groups of the last search in the chosen order, when its destination covers more
   * than one airport; undefined otherwise. Switching the sort reorders them at once.
   */
  protected readonly groups = computed(() => {
    const found = this.found();
    const texts = this.texts();
    const searched = this.searched();
    if (!found || !texts || !searched) return undefined;
    if (!coversSeveralAirports(searched.destination, searched.exclusions, this.catalogue()))
      return undefined;
    return destinationGroups(
      sortOffers(found.offers, this.sort()),
      found.at,
      texts,
      this.catalogue(),
    );
  });
  /**
   * Offers of the last search in the chosen order, shown in the interface language; undefined
   * before the first search. Switching the sort reorders them at once.
   */
  protected readonly offers = computed(() => {
    const groups = this.groups();
    if (groups) return groups.flatMap((g) => g.offers);
    const found = this.found();
    const texts = this.texts();
    return found && texts
      ? sortOffers(found.offers, this.sort()).map((o) =>
          offerView(o, found.at, texts, this.catalogue()),
        )
      : undefined;
  });
  /** The form as it was when the last successful search was made; undefined before one. */
  private readonly searched = signal<SearchFormValue | undefined>(undefined);
  /** Whether the form is folded away into the summary of the last search. */
  protected readonly collapsed = signal(false);
  /** The one line that stands in for the form after a search. */
  protected readonly summary = computed(() => {
    const searched = this.searched();
    const catalogue = this.catalogue();
    const texts = this.texts();
    const language = this.language();
    if (!this.collapsed() || !searched || !catalogue || !texts || !language) return undefined;
    return summarySearch(searched, catalogue, texts, language, this.found()?.at ?? Date.now());
  });
  /** What a search that found no offers says and suggests, from the query that was searched; undefined if it found offers. */
  protected readonly noOffers = computed(() => {
    const found = this.found();
    const searched = this.searched();
    const texts = this.texts();
    const language = this.language();
    return found && searched && texts && language && found.offers.length === 0
      ? describeNoOffers(searched, this.catalogue(), language, texts, localIsoDate(0))
      : undefined;
  });
  protected readonly loading = signal(false);
  /** The translation key of the last search's failure. */
  protected readonly error = signal<string | undefined>(undefined);
  /** Whether the user has tried to search; invalid fields are marked only after that. */
  protected readonly submitted = signal(false);

  constructor() {
    this.form.controls.sort.valueChanges.pipe(takeUntilDestroyed()).subscribe((sort) => {
      // The sort is chosen over the results, after searching: remember it on its own.
      saveSearchSettings({ ...loadSearchSettings(), sort });
    });
    // Fields that do not apply to the kind of offer are disabled: a disabled control does not
    // affect the form's validity, and the raw value keeps it so remembered settings lose nothing.
    merge(this.form.controls.kind.valueChanges, this.form.controls.dateMode.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateApplicableFields());
    for (const name of ['workStart', 'workEnd'] as const) {
      this.form.controls.leave.controls[name].valueChanges
        .pipe(takeUntilDestroyed())
        .subscribe((value) => {
          if (workTime.test(value)) this.lastWorkHours[name] = value;
        });
    }
    this.form.controls.leave.controls.ignoreLeave.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateLeaveLimit());
    merge(this.form.controls.from.valueChanges, this.form.controls.to.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.greyOutImpossibleDays());
    const settings = loadSearchSettings();
    if (settings) {
      this.form.patchValue(settings);
      // A remembered flexible travel window in the past would make the form open on a failing search.
      if (this.form.controls.dateMode.value === 'flexible') this.dropPastWindow();
    }
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
    this.loadCatalogue();
  }

  /** Replaces a window that has ended with the default; starts one that has begun tomorrow. */
  private dropPastWindow() {
    const { from, to } = this.form.controls;
    const today = localIsoDate(0);
    const defaults = defaultTravelWindow();
    if ((to.value || from.value) < today) this.form.patchValue(defaults);
    else if (from.value < today)
      // A window that ends today can only start today.
      from.setValue(to.value < defaults.from ? today : defaults.from);
  }

  /** Retry a failed load; only validated places may be selected or submitted. */
  protected loadCatalogue() {
    if (this.catalogueStatus() === 'loading') return;
    this.catalogueStatus.set('loading');
    combineLatest([this.http.get<Catalogue>('/api/catalogue'), this.placeTranslations.names$])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([catalogue]) => {
          this.catalogue.set(catalogue);
          for (const field of ['homeAirports', 'destination', 'exclusions'] as const) {
            this.form.controls[field].setValue(
              restorePlaces(
                this.form.controls[field].value,
                catalogue,
                field,
                this.placeTranslations.anywhere('en'),
              ),
            );
          }
          this.catalogueStatus.set('ready');
        },
        error: () => this.catalogueStatus.set('error'),
      });
  }

  protected submit() {
    this.submitted.set(true);
    // A form left open over local midnight must not submit yesterday's dates.
    for (const date of [this.form.controls.from, this.form.controls.to])
      date.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid || !this.catalogue()) {
      // A search made while the form is folded away must bring the problem into view.
      this.collapsed.set(false);
      // A blocking field inside a collapsed section would otherwise stay out of sight.
      if (this.form.controls.leave.invalid) this.leaveOpen.set(true);
      if (
        this.form.controls.filters.invalid ||
        this.noDayLeft('outboundDepartureWeekdays') ||
        this.noDayLeft('inboundDepartureWeekdays')
      )
        this.filtersOpen.set(true);
      return;
    }
    const v = this.form.getRawValue();
    saveSearchSettings(v);
    this.loading.set(true);
    this.error.set(undefined);
    this.http.post<SearchResponse>('/api/search', buildSearchQuery(v, this.catalogue())).subscribe({
      next: (resp) => {
        this.found.set({ offers: resp.offers, at: Date.now() });
        this.searched.set(v);
        this.collapsed.set(true);
        this.loading.set(false);
        this.focusResults();
      },
      error: (error: HttpErrorResponse) => {
        const reason = typeof error.error === 'string' ? error.error.trim() : '';
        this.error.set(
          error.status === 400 ? rejectedSearchMessage(reason) : 'search.errors.server',
        );
        this.loading.set(false);
        // A failed search keeps the form open, so the user can fix it.
        this.collapsed.set(false);
      },
    });
  }

  /** Bring the form back to change the search; every value is still in it. */
  protected change() {
    this.collapsed.set(false);
    afterNextRender(
      () => this.element.nativeElement.querySelector<HTMLElement>('app-place-chips input')?.focus(),
      { injector: this.injector },
    );
  }

  /** Applies a suggested change to the form and searches again. */
  protected applySuggestion(id: SuggestionId) {
    const suggestion = this.noOffers()?.suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    this.form.patchValue(suggestion.patch);
    this.submit();
  }

  /** Move focus to the results heading, or to the message of a search that found nothing. */
  private focusResults() {
    afterNextRender(
      () => {
        const target = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-testid="results"] h2',
        );
        target?.setAttribute('tabindex', '-1');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  /** The text under `key` in the interface language; empty until the language's texts have loaded. */
  protected t(key: string, params?: Record<string, unknown>): string {
    return this.texts()?.t(key, params) ?? '';
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

  /** Hidden leave settings cannot block search; badges use the last valid work hours. */
  private updateLeaveLimit() {
    const leave = this.form.controls.leave.controls;
    for (const name of ['workStart', 'workEnd'] as const) {
      const control = leave[name];
      if (leave.ignoreLeave.value) control.setValue(this.lastWorkHours[name], { emitEvent: false });
      if (this.form.controls.kind.value === 'roundTrip' && !leave.ignoreLeave.value)
        control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
    }
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

  /** Whether the form field named by its control path applies to the chosen kind of offer. */
  protected applies(path: string): boolean {
    return fieldApplies(path, this.kind(), this.dateMode());
  }

  /** A field's short validation message, shown only after a search attempt. */
  protected validationMessage(path: string): string {
    if (!this.invalid(path)) return '';
    if (path.startsWith('filters.') && this.noDayLeft(path.slice(8) as DepartureDays))
      return this.t('search.validation.departureDay');
    if (this.form.get(path)?.hasError('pastDate')) return this.t('search.validation.pastDate');
    if (path === 'to' && this.invalidFixedDates()) return this.t('search.hint.fixedDateOrder');
    if (path === 'to' && this.form.hasError('dateOrder'))
      return this.t('search.validation.dateOrder');
    if (path.startsWith('stayLength.')) {
      return this.t(
        'search.validation.' + (this.form.get(path)?.invalid ? 'nightCount' : 'nightOrder'),
      );
    }
    if (this.form.get(path)?.hasError('halfSet')) return this.t('search.validation.timeRange');
    if (this.form.get(path)?.hasError('chooseSuggestion'))
      return this.t('search.validation.chooseSuggestion');
    const keys: Record<string, string> = {
      homeAirports: 'homeAirports',
      destination: 'destination',
      from: 'dateRequired',
      to: 'dateRequired',
      'leave.workStart': 'workStart',
      'leave.workEnd': 'workEnd',
      'leave.maxLeaveDays': 'leaveCount',
    };
    return keys[path] ? this.t('search.validation.' + keys[path]) : '';
  }

  protected errorId(path: string): string | null {
    return this.validationMessage(path) ? 'search-error-' + path.replaceAll('.', '-') : null;
  }

  /** Whether a field, named by its path like "leave.workStart", should be marked invalid: it is, and the user has tried to search. */
  protected invalid(path: string): boolean {
    return (
      this.submitted() &&
      (!!this.form.get(path)?.invalid ||
        (path.startsWith('filters.') && this.noDayLeft(path.slice(8) as DepartureDays)) ||
        (path === 'to' && (!!this.form.errors?.['dateOrder'] || this.invalidFixedDates())) ||
        (path === 'stayLength.max' && this.form.controls.stayLength.hasError('maxBelowMin')))
    );
  }
}
