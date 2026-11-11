// PROTOTYPE (throwaway): variant B "Sidebar" - app shell like a chat client: left sidebar with
// "New search" and recent searches (in memory only), a segmented search pill on top, results as a table.
import { Component, input, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import type { ApiStatus } from '../app';
import { Search } from '../search/search';

interface Recent {
  from: string;
  to: string;
  start: string;
  end: string;
}

@Component({
  selector: 'app-variant-b',
  imports: [ReactiveFormsModule],
  templateUrl: './variant-b.html',
  styleUrl: './variant-b.css',
})
export class VariantB extends Search {
  readonly status = input<ApiStatus>();
  protected readonly recent = signal<Recent[]>([]);

  protected override submit() {
    if (this.form.valid) {
      const v = this.form.getRawValue();
      const item: Recent = {
        from: v.homeAirport.toUpperCase(),
        to: v.destinationAirport.toUpperCase(),
        start: v.from,
        end: v.to,
      };
      const same = (r: Recent) =>
        r.from === item.from && r.to === item.to && r.start === item.start && r.end === item.end;
      this.recent.update((list) => [item, ...list.filter((r) => !same(r))].slice(0, 8));
    }
    super.submit();
  }

  protected rerun(r: Recent) {
    this.form.setValue({ homeAirport: r.from, destinationAirport: r.to, from: r.start, to: r.end });
    this.submit();
  }

  protected reset() {
    this.form.reset();
    this.offers.set(undefined);
    this.error.set(undefined);
  }
}
