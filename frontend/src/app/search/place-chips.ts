import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  NG_VALIDATORS,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { TranslocoService } from '@jsverse/transloco';
import { Catalogue } from './search-api';
import {
  PlaceSelection,
  placeValue,
  readPlaceSelections,
  writePlaceSelections,
} from './place-selection';
import { PlaceTranslations } from './place-translations';
import { cataloguePlaces, PlaceField, PlaceSuggestion, suggestPlaces } from './place-suggestions';

/** Catalogue-backed multi-select following the editable combobox/listbox ARIA pattern. */
@Component({
  selector: 'app-place-chips',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PlaceChips), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => PlaceChips), multi: true },
  ],
  styleUrl: './place-chips.css',
  host: { '(document:click)': 'clickOutside($event)' },
  template: `
    <label [for]="id + '-input'">{{ label() }}</label>
    <div class="chips" (click)="focusInput($event)">
      @for (place of shownChips(); track place.value) {
        <span
          class="chip"
          [attr.data-place-chip]="place.value"
          [attr.title]="place.kind === 'city' ? cityAirports(place) : null"
        >
          <span class="chip-name">{{ shortLabel(place) }}</span>
          @if (place.kind === 'city') {
            <span class="city-airports">({{ cityAirports(place) }})</span>
          }
          <button
            type="button"
            [disabled]="disabled() || !catalogue()"
            [attr.aria-label]="t('places.remove', { place: shortLabel(place) })"
            (click)="remove(place.value)"
          >
            ×
          </button>
        </span>
      }
      @if (hiddenChips().length) {
        <button
          type="button"
          class="more"
          [id]="id + '-more'"
          [disabled]="disabled() || !catalogue()"
          [attr.aria-expanded]="listOpen()"
          [attr.aria-controls]="id + '-chosen'"
          [attr.aria-label]="
            t('places.more', { count: hiddenChips().length, places: hiddenNames() })
          "
          [attr.title]="hiddenNames()"
          (click)="toggleList()"
        >
          +{{ hiddenChips().length }}
        </button>
      }
      @if (listOpen()) {
        <div
          class="chosen-list"
          animate.enter="dropdown-enter"
          animate.leave="dropdown-leave"
          role="group"
          [id]="id + '-chosen'"
          [attr.aria-label]="t('places.chosen', { count: chosen().length })"
          (keydown)="listKey($event)"
        >
          <div class="chosen-heading">
            <span>{{ t('places.chosen', { count: chosen().length }) }}</span>
            <button type="button" class="clear" (click)="clearAll()">
              {{ t('places.clearAll') }}
            </button>
          </div>
          <ul>
            @for (place of chosen(); track place.value; let i = $index) {
              <li [attr.data-chosen-place]="place.value">
                <span>{{ listLabel(place) }}</span>
                <button
                  type="button"
                  [attr.aria-label]="t('places.remove', { place: shortLabel(place) })"
                  (click)="removeFromList(place.value, i)"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        </div>
      }
      <input
        [id]="id + '-input'"
        role="combobox"
        [attr.aria-label]="label()"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        [attr.aria-controls]="id + '-list'"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="open() && active() >= 0 ? id + '-option-' + active() : null"
        [attr.aria-invalid]="invalid()"
        [attr.aria-describedby]="error() ? id + '-error' : null"
        [disabled]="disabled() || !catalogue()"
        autocomplete="off"
        [placeholder]="chosen().length ? '' : placeholder()"
        [value]="text()"
        (input)="type($event)"
        (focus)="focus()"
        (blur)="blur()"
        (keydown)="key($event)"
      />
    </div>
    @if (error()) {
      <span
        class="field-error"
        animate.enter="field-error-enter"
        animate.leave="field-error-leave"
        [id]="id + '-error'"
        role="alert"
        >{{ error() }}</span
      >
    }
    @if (open()) {
      <div
        role="listbox"
        [id]="id + '-list'"
        [attr.aria-label]="label()"
        class="suggestions"
        animate.enter="dropdown-enter"
        animate.leave="dropdown-leave"
      >
        @for (place of suggestions(); track place.value; let i = $index) {
          <button
            type="button"
            role="option"
            tabindex="-1"
            [id]="id + '-option-' + i"
            [attr.aria-selected]="active() === i"
            [attr.aria-label]="optionLabel(place)"
            (mousedown)="$event.preventDefault()"
            (click)="choose(place)"
          >
            {{ optionText(place) }}
          </button>
        } @empty {
          <span class="no-matches">{{ t('places.noMatches') }}</span>
        }
      </div>
    }
  `,
})
export class PlaceChips implements ControlValueAccessor, Validator {
  private static nextId = 0;
  private static readonly shownChips = 2;
  protected readonly id = `places-${PlaceChips.nextId++}`;
  readonly catalogue = input<Catalogue>();
  readonly field = input.required<PlaceField>();
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly language = input('en');
  readonly excluded = input('');
  readonly invalid = input(false);
  readonly error = input('');
  private readonly transloco = inject(TranslocoService);
  private readonly placeTranslations = inject(PlaceTranslations);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly selected = signal<PlaceSelection[]>([]);
  protected readonly text = signal('');
  protected readonly focused = signal(false);
  protected readonly active = signal(-1);
  protected readonly disabled = signal(false);
  /** Whether the list of every chosen place is open, from the "+N" button. */
  protected readonly listOpen = signal(false);
  protected readonly open = computed(
    () => this.focused() && !this.disabled() && !!this.catalogue(),
  );
  protected readonly chosen = computed(() => {
    const catalogue = this.catalogue();
    const all = catalogue
      ? cataloguePlaces(
          catalogue,
          this.field(),
          this.language(),
          this.placeTranslations.anywhere(this.language()),
        )
      : [];
    return this.selected()
      .map((place) => all.find((p) => p.value === placeValue(place)))
      .filter((p) => p !== undefined);
  });
  /** The first few chips; the rest wait behind "+N", so the field stays one row tall. */
  protected readonly shownChips = computed(() => this.chosen().slice(0, PlaceChips.shownChips));
  protected readonly hiddenChips = computed(() => this.chosen().slice(PlaceChips.shownChips));
  protected readonly hiddenNames = computed(() =>
    this.hiddenChips()
      .map((place) => this.shortLabel(place))
      .join(', '),
  );
  protected readonly suggestions = computed(() =>
    suggestPlaces(
      this.text(),
      this.catalogue(),
      this.field(),
      this.selected().map(placeValue),
      readPlaceSelections(this.excluded()).map(placeValue),
      this.language(),
      this.placeTranslations.anywhere(this.language()),
    ),
  );
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private onValidatorChange: () => void = () => {};
  validate(): ValidationErrors | null {
    return this.text().trim() ? { chooseSuggestion: true } : null;
  }
  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }
  writeValue(value: unknown): void {
    this.selected.set(readPlaceSelections(value));
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params, this.language());
  }
  protected shortLabel(place: PlaceSuggestion): string {
    return place.kind === 'airport' ? `${place.code} ${place.name}` : place.name;
  }
  /** The codes of a city's airports, so the user sees what choosing the city covers. */
  protected cityAirports(place: PlaceSuggestion): string {
    return place.airports.join(', ');
  }
  /** Visible text: an airport reads "KRK Kraków, Polska"; its kind lives in the accessible name. */
  protected optionText(place: PlaceSuggestion): string {
    return place.kind === 'airport'
      ? [this.shortLabel(place), place.context].filter(Boolean).join(', ')
      : this.optionLabel(place);
  }
  protected optionLabel(place: PlaceSuggestion): string {
    const name = [this.shortLabel(place), place.context].filter(Boolean).join(', ');
    return place.kind === 'anywhere'
      ? name
      : `${name} — ${this.t('places.' + place.kind)}${place.kind === 'city' ? ' · ' + this.cityAirports(place) : ''}`;
  }
  /** Clicking between or beside the chips starts typing, as clicking an ordinary input would. */
  protected focusInput(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('button, .chosen-list')) this.input()?.focus();
  }
  protected focus(): void {
    this.listOpen.set(false);
    this.focused.set(true);
  }
  protected listLabel(place: PlaceSuggestion): string {
    return place.kind === 'city'
      ? `${this.shortLabel(place)} (${this.cityAirports(place)})`
      : this.shortLabel(place);
  }
  protected toggleList(): void {
    this.listOpen.update((open) => !open);
  }
  protected clickOutside(event: MouseEvent): void {
    if (this.listOpen() && !this.element.nativeElement.contains(event.target as Node)) {
      this.listOpen.set(false);
    }
  }
  protected listKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.listOpen.set(false);
      this.element.nativeElement.querySelector<HTMLElement>(`#${this.id}-more`)?.focus();
    }
  }
  /** Removes a place from the open list, keeping focus in the list while places stay hidden. */
  protected removeFromList(value: string, index: number): void {
    this.remove(value);
    if (!this.hiddenChips().length) {
      this.listOpen.set(false);
      this.input()?.focus();
      return;
    }
    afterNextRender(
      () => {
        const buttons =
          this.element.nativeElement.querySelectorAll<HTMLElement>('.chosen-list li button');
        buttons[Math.min(index, buttons.length - 1)]?.focus();
      },
      { injector: this.injector },
    );
  }
  protected clearAll(): void {
    this.selected.set([]);
    this.onChange(writePlaceSelections(this.selected()));
    this.listOpen.set(false);
    this.input()?.focus();
  }
  private input(): HTMLInputElement | null {
    return this.element.nativeElement.querySelector('input');
  }
  protected type(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.focused.set(true);
    this.active.set(-1);
    this.onValidatorChange();
  }
  protected blur(): void {
    this.focused.set(false);
    this.active.set(-1);
    this.onTouched();
    this.onValidatorChange();
  }
  protected choose(place: PlaceSuggestion): void {
    const places =
      this.field() === 'homeAirports' && place.kind === 'country'
        ? place.airports.map((code): PlaceSelection => ({ kind: 'airport', code }))
        : [place];
    this.selected.update((selected) =>
      place.kind === 'anywhere'
        ? [place]
        : [
            ...selected,
            ...places.filter((place) => !selected.some((p) => placeValue(p) === placeValue(place))),
          ],
    );
    this.text.set('');
    this.onChange(writePlaceSelections(this.selected()));
    this.onValidatorChange();
    this.active.set(-1);
    this.focused.set(false);
  }
  protected remove(value: string): void {
    this.selected.update((values) => values.filter((p) => placeValue(p) !== value));
    this.onChange(writePlaceSelections(this.selected()));
  }
  protected key(event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.text()) {
      const last = this.selected().at(-1);
      if (last) {
        event.preventDefault();
        this.remove(placeValue(last));
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.focused.set(false);
      this.active.set(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.focused.set(true);
      const count = this.suggestions().length;
      if (count)
        this.active.set(
          this.active() < 0
            ? event.key === 'ArrowDown'
              ? 0
              : count - 1
            : (this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count,
        );
      afterNextRender(
        () =>
          this.element.nativeElement
            .querySelector<HTMLElement>('[aria-selected="true"]')
            ?.scrollIntoView?.({ block: 'nearest' }),
        { injector: this.injector },
      );
    } else if (event.key === 'Enter' && this.open()) {
      event.preventDefault();
      const place = this.suggestions()[Math.max(0, this.active())];
      if (place) this.choose(place);
    }
  }
}
