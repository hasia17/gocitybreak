import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Texts } from './texts';

/** The languages of the interface (ADR-0007); adding one means adding its JSON file to public/i18n. */
export const languages = ['pl', 'en'] as const;

export type Language = (typeof languages)[number];

/** The language for anyone whose browser language we do not offer. */
export const defaultLanguage: Language = 'en';

/** The locale that formats dates, numbers and money in each language. */
export const locales: Record<Language, string> = { pl: 'pl-PL', en: 'en-GB' };

const key = 'gocitybreak.language';

/** The texts and formats of `language`, translated by `transloco` once the language is loaded. */
export function textsIn(transloco: TranslocoService, language: Language): Texts {
  return {
    locale: locales[language],
    t: (k, params) => transloco.translate(k, params, language),
  };
}

/**
 * The language to start in: the one the user chose before, else the browser's (Polish for any
 * `pl` variant), else English.
 */
export function startLanguage(stored: string | null, browser: string | undefined): Language {
  if (languages.includes(stored as Language)) return stored as Language;
  return browser?.toLowerCase().split('-')[0] === 'pl' ? 'pl' : defaultLanguage;
}

/** The interface language: starts from the remembered or browser language and remembers each switch. */
@Injectable({ providedIn: 'root' })
export class LanguageSwitch {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly language = signal<Language>(defaultLanguage);

  /** The language the interface is shown in. */
  readonly current = this.language.asReadonly();

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(key);
    } catch {
      // Blocked storage: fall back to the browser language.
    }
    this.apply(startLanguage(stored, this.document.defaultView?.navigator.language));
  }

  /** Switches the interface to `language` and remembers the choice in the browser. */
  use(language: Language): void {
    this.apply(language);
    try {
      localStorage.setItem(key, language);
    } catch {
      // Remembering is a convenience: the switch itself must work without it.
    }
  }

  private apply(language: Language): void {
    this.language.set(language);
    this.transloco.setActiveLang(language);
    this.document.documentElement.lang = language;
  }
}
