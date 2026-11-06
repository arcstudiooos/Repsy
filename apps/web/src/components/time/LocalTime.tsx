'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * False during the server render and hydration, true afterwards. Output that depends on the viewer's locale or
 * time zone must not be rendered until this is true, or the server and browser markup differ (hydration error).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const DEFAULT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * A timestamp for display. Before hydration it is fixed (en-GB, UTC) so server and browser render the same text;
 * once hydrated it is in the viewer's own locale and time zone (QA 2026-11-06, B3/B4).
 */
export function formatWhen(
  iso: string,
  hydrated: boolean,
  options: Intl.DateTimeFormatOptions = DEFAULT,
): string {
  const d = new Date(iso);
  return hydrated
    ? d.toLocaleString(undefined, options)
    : d.toLocaleString('en-GB', { ...options, timeZone: 'UTC' });
}

/** The calendar day of a timestamp, for grouping: the viewer's day once hydrated, the UTC day before. */
export function dayKey(iso: string, hydrated: boolean): string {
  return hydrated ? new Date(iso).toDateString() : iso.slice(0, 10);
}

/** A `<time>` element using {@link formatWhen}. */
export function LocalTime({
  iso,
  options = DEFAULT,
}: {
  iso: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{formatWhen(iso, hydrated, options)}</time>;
}
