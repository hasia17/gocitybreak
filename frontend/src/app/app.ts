import { httpResource } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LanguageSwitch, languages } from './i18n/language';
import { Search } from './search/search';

/** Response of the backend's GET /api/status. */
interface ApiStatus {
  status: string;
  version: string;
  database: { status: string; schemaVersion?: number };
}

@Component({
  selector: 'app-root',
  imports: [Search, TranslocoDirective],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly apiStatus = httpResource<ApiStatus>(() => '/api/status');
  protected readonly language = inject(LanguageSwitch);
  protected readonly languages = languages;
}
