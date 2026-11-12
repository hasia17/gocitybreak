import { isDevMode } from '@angular/core';
import { TranslocoOptions, provideTransloco } from '@jsverse/transloco';
import { defaultLanguage, languages } from './language';
import { TranslocoHttpLoader } from './transloco-loader';

/** Transloco settings shared by the app and its tests. */
export const translocoConfig: TranslocoOptions['config'] = {
  availableLangs: [...languages],
  defaultLang: defaultLanguage,
  fallbackLang: defaultLanguage,
  reRenderOnLangChange: true,
  prodMode: !isDevMode(),
  missingHandler: { useFallbackTranslation: true },
};

/** Runtime translations of the interface, loaded per language over HTTP (ADR-0007). */
export function provideI18n() {
  return provideTransloco({ config: translocoConfig, loader: TranslocoHttpLoader });
}
