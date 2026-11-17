import { Component, input } from '@angular/core';

/**
 * A field's validation message: an alert that `aria-describedby` points at through `errorId`,
 * fading in and out as it comes and goes (the motion classes are global, in styles.css).
 */
@Component({
  selector: 'app-field-error',
  styleUrl: './field-error.css',
  template: `
    @if (message()) {
      <span
        class="field-error"
        animate.enter="field-error-enter"
        animate.leave="field-error-leave"
        role="alert"
        [id]="errorId()"
        >{{ message() }}</span
      >
    }
  `,
})
export class FieldError {
  /** The message to show; nothing shows while it is empty. */
  readonly message = input<string | null | undefined>();
  /** The id of the alert, for the field's `aria-describedby`. */
  readonly errorId = input.required<string | null>();
}
