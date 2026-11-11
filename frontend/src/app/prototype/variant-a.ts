// PROTOTYPE (throwaway): variant A "Composer" - centred greeting, one big rounded composer
// card holding every field (like a chat input), results as ticket tiles in a grid.
import { Component, input } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import type { ApiStatus } from '../app';
import { Search } from '../search/search';

@Component({
  selector: 'app-variant-a',
  imports: [ReactiveFormsModule],
  templateUrl: './variant-a.html',
  styleUrl: './variant-a.css',
})
export class VariantA extends Search {
  readonly status = input<ApiStatus>();
  protected readonly routes = [
    ['KRK', 'BGY'],
    ['KTW', 'CIA'],
    ['WRO', 'STN'],
  ];

  protected fill(from: string, to: string) {
    this.form.setValue({
      homeAirport: from,
      destinationAirport: to,
      from: inDays(7),
      to: inDays(14),
    });
    this.submit();
  }
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
