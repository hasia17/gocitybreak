import { Texts } from './texts';

/** Base of the components whose templates show texts of the interface language through `t`. */
export abstract class Translated {
  /** Texts of the interface language; undefined until they have loaded. */
  protected abstract readonly texts: () => Texts | undefined;

  /** The text under `key` in the interface language; empty until the language's texts have loaded. */
  protected t(key: string, params?: Record<string, unknown>): string {
    return this.texts()?.t(key, params) ?? '';
  }
}
