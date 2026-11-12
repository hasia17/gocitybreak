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
  template: `
    <label [for]="id + '-input'">{{ label() }}</label>
    <div class="chips">
      @for (place of chosen(); track place.value) {
        <span class="chip" [attr.data-place-chip]="place.value">
          {{ shortLabel(place) }}
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
        [placeholder]="placeholder()"
        [value]="text()"
        (input)="type($event)"
        (focus)="focused.set(true)"
        (blur)="blur()"
        (keydown)="key($event)"
      />
    </div>
    @if (error()) {
      <span class="field-error" [id]="id + '-error'" role="alert">{{ error() }}</span>
    }
    @if (open()) {
      <div role="listbox" [id]="id + '-list'" [attr.aria-label]="label()" class="suggestions">
        @for (place of suggestions(); track place.value; let i = $index) {
          <button
            type="button"
            role="option"
            tabindex="-1"
            [id]="id + '-option-' + i"
            [attr.aria-selected]="active() === i"
            (mousedown)="$event.preventDefault()"
            (click)="choose(place)"
          >
            {{ optionLabel(place) }}
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
  protected optionLabel(place: PlaceSuggestion): string {
    const name = [this.shortLabel(place), place.context].filter(Boolean).join(', ');
    return place.kind === 'anywhere'
      ? name
      : `${name} — ${this.t('places.' + place.kind)}${place.kind === 'city' ? ' · ' + this.t('places.airportCount', { count: place.airports.length }) : ''}`;
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
