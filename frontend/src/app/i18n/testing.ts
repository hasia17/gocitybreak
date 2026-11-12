import { importProvidersFrom } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import en from '../../../public/i18n/en.json';
import pl from '../../../public/i18n/pl.json';
import { translocoConfig } from './i18n';

/**
 * Transloco for tests: the real translation files, preloaded, so components render their texts
 * without an HTTP request; English unless a test switches language.
 */
export function provideTestI18n() {
  return importProvidersFrom(
    TranslocoTestingModule.forRoot({
      langs: { en, pl },
      preloadLangs: true,
      translocoConfig: { ...translocoConfig, prodMode: true },
    }),
  );
}
