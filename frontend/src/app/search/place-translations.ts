import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { combineLatest, map, shareReplay } from 'rxjs';
import { languages } from '../i18n/language';
import { AnywhereLabel } from './place-suggestions';

/** Load each dictionary's choice name so matching works in every interface language. */
@Injectable({ providedIn: 'root' })
export class PlaceTranslations {
  private readonly transloco = inject(TranslocoService);
  readonly names$ = combineLatest(
    languages.map((language) =>
      this.transloco
        .selectTranslate<string>('places.anywhere', {}, language)
        .pipe(map((name) => [language, name] as const)),
    ),
  ).pipe(
    map((entries) => Object.fromEntries(entries)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  private readonly names = toSignal(this.names$);

  anywhere(language: string): AnywhereLabel | undefined {
    const names = this.names();
    return names ? { name: names[language], names: Object.values(names) } : undefined;
  }
}
