import { httpResource } from '@angular/common/http';
import { Component, computed, isDevMode, signal } from '@angular/core';
import { PrototypeSwitcher } from './prototype/prototype-switcher';
import { VariantA } from './prototype/variant-a';
import { VariantB } from './prototype/variant-b';
import { VariantC } from './prototype/variant-c';
import { Search } from './search/search';

/** Response of the backend's GET /api/status. */
export interface ApiStatus {
  status: string;
  version: string;
  database: { status: string; schemaVersion?: number };
}

@Component({
  selector: 'app-root',
  imports: [Search, VariantA, VariantB, VariantC, PrototypeSwitcher],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly apiStatus = httpResource<ApiStatus>(() => '/api/status');

  // PROTOTYPE: look-and-feel variants, picked by ?variant=; production builds always show the current page.
  protected readonly dev = isDevMode();
  protected readonly variant = signal(
    (this.dev && new URLSearchParams(location.search).get('variant')) || 'now',
  );
  protected readonly status = computed(() =>
    this.apiStatus.hasValue() ? this.apiStatus.value() : undefined,
  );
}
