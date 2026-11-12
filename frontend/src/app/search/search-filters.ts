import { AbstractControl, NonNullableFormBuilder, ValidationErrors } from '@angular/forms';

/** A time range with only one of its ends set; a range needs both, or neither to restrict nothing. */
function halfSet(range: AbstractControl): ValidationErrors | null {
  const { from, to } = range.value as { from: string; to: string };
  return !from !== !to ? { halfSet: true } : null;
}

/** Form controls of the filters; their initial values restrict nothing: every departure day is ticked. */
export function filtersForm(fb: NonNullableFormBuilder) {
  const timeRange = () => fb.group({ from: '', to: '' }, { validators: halfSet });
  const days = () =>
    fb.group({
      mon: true,
      tue: true,
      wed: true,
      thu: true,
      fri: true,
      sat: true,
      sun: true,
    });
  return fb.group({
    directOnly: false,
    outboundDeparture: timeRange(),
    outboundArrival: timeRange(),
    inboundDeparture: timeRange(),
    inboundArrival: timeRange(),
    outboundDepartureWeekdays: days(),
    inboundDepartureWeekdays: days(),
  });
}
