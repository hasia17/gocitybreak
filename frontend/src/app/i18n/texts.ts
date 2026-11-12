/** Translated texts and locale formats of one language, for code that builds display values. */
export interface Texts {
  /** The locale of dates, numbers and money, like "pl-PL". */
  locale: string;
  /** The text under `key` of the language's JSON file, with `{{param}}` placeholders filled in. */
  t(key: string, params?: Record<string, unknown>): string;
}

/**
 * The text for a count: the key's plural form for `count` in the locale (`one`, `few`, `many` or
 * `other`, as `Intl.PluralRules` names them), with `{{count}}` filled in.
 */
export function plural(texts: Texts, key: string, count: number): string {
  const form = new Intl.PluralRules(texts.locale).select(count);
  return texts.t(`${key}.${form}`, { count });
}

/** A price like "123,45 zł" or "PLN 123.45", prefixed with "≈ " when approximate. */
export function money(
  texts: Texts,
  price: { amount: number; currency: string; approximate?: boolean },
): string {
  const amount = new Intl.NumberFormat(texts.locale, {
    style: 'currency',
    currency: price.currency,
  }).format(price.amount);
  return price.approximate ? `≈ ${amount}` : amount;
}

/** A day like "pt 13 lis" or "Fri 13 Nov", with the year appended when `withYear` is set. */
export function shortDay(texts: Texts, isoDate: string, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat(texts.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(Date.parse(isoDate));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value.replace(/\.$/, '') ?? '';
  const day = `${part('weekday')} ${part('day')} ${part('month')}`;
  return withYear ? `${day} ${isoDate.slice(0, 4)}` : day;
}

/** How long ago a moment was, like "5 min ago" or "2 dni temu"; a future moment counts as now. */
export function ago(texts: Texts, at: string, now: number): string {
  const format = new Intl.RelativeTimeFormat(texts.locale, { style: 'short', numeric: 'always' });
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  const hours = Math.round(minutes / 60);
  return minutes < 60
    ? format.format(-minutes, 'minute')
    : hours < 48
      ? format.format(-hours, 'hour')
      : format.format(-Math.round(hours / 24), 'day');
}
