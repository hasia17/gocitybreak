import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LanguageSwitch, languages } from './i18n/language';
import { Search } from './search/search';

@Component({
  selector: 'app-root',
  imports: [Search, TranslocoDirective],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly language = inject(LanguageSwitch);
  protected readonly languages = languages;
}
