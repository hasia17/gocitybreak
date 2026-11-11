// PROTOTYPE (throwaway): variant C "Conversation" - the search is a thread. A sentence-shaped
// composer ("Fly from __ to __ between __ and __"), each search becomes a question + an answer
// with the offers inside it. Thread lives in memory only.
import { Component, effect, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import type { ApiStatus } from '../app';
import { Offer } from '../search/search-api';
import { Search } from '../search/search';

interface Turn {
  ask: string;
  pending: boolean;
  offers?: Offer[];
  error?: string;
}

@Component({
  selector: 'app-variant-c',
  imports: [ReactiveFormsModule],
  templateUrl: './variant-c.html',
  styleUrl: './variant-c.css',
})
export class VariantC extends Search {
  readonly status = input<ApiStatus>();
  protected readonly turns = signal<Turn[]>([]);
  protected readonly routes = [
    ['KRK', 'BGY'],
    ['KTW', 'CIA'],
    ['WRO', 'STN'],
  ];

  constructor() {
    super();
    // Attach the result of the running search to the last, still pending turn.
    effect(() => {
      const loading = this.loading();
      const offers = this.offers();
      const error = this.error();
      untracked(() => {
        const turns = this.turns();
        const last = turns.at(-1);
        if (loading || !last?.pending) return;
        this.turns.set([
          ...turns.slice(0, -1),
          { ...last, pending: false, offers: error ? undefined : offers, error },
        ]);
        setTimeout(() => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      });
    });
  }

  protected override submit() {
    if (this.form.valid) {
      const v = this.form.getRawValue();
      const ask = `${v.homeAirport.toUpperCase()} → ${v.destinationAirport.toUpperCase()}, between ${v.from} and ${v.to}`;
      this.turns.update((t) => [...t, { ask, pending: true }]);
    }
    super.submit();
  }

  protected fill(from: string, to: string) {
    this.form.setValue({
      homeAirport: from,
      destinationAirport: to,
      from: inDays(7),
      to: inDays(14),
    });
    this.submit();
  }

  protected cheapest(offers: Offer[]): Offer {
    return offers.reduce((a, b) => (a.price.amount <= b.price.amount ? a : b));
  }
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
