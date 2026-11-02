/** Money helpers (D-013 #2): integer minor units in one ISO 4217 currency per workspace. */
export const CURRENCY = /^[A-Z]{3}$/;

/** Minor units per major unit for `currency` (JPY 0, USD 2, KWD 3), from the runtime's currency data. */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** True when the runtime knows the currency code. */
export function isCurrency(code: unknown): code is string {
  if (typeof code !== 'string' || !CURRENCY.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return false;
  }
}

export function formatMoney(minor: number, currency: string, locale = 'en-GB'): string {
  const digits = minorDigits(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** digits,
  );
}

/** A typed amount ("49", "49.5", "1,299.00") to minor units, or null when it isn't a valid amount. */
export function parseMoney(text: string, currency: string): number | null {
  const digits = minorDigits(currency);
  const t = text.trim().replace(/,/g, '');
  const re = digits === 0 ? /^\d{1,9}$/ : new RegExp(`^\\d{1,9}(\\.\\d{1,${digits}})?$`);
  if (!re.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
}

export interface CouponTerms {
  kind: 'percent' | 'fixed';
  value: number;
}

/** The first charge after a coupon (D-013 #5): never below zero, rounded half up. */
export function discounted(amountMinor: number, coupon: CouponTerms | null): number {
  if (!coupon) return amountMinor;
  const off =
    coupon.kind === 'percent' ? Math.round((amountMinor * coupon.value) / 100) : coupon.value;
  return Math.max(0, amountMinor - off);
}

/** Monthly recurring value of one charge (D-013 #9): weekly prices × 52 / 12. */
export function monthlyValue(amountMinor: number, unit: 'week' | 'month', count: number): number {
  const perMonth = unit === 'week' ? (amountMinor * 52) / 12 / count : amountMinor / count;
  return Math.round(perMonth);
}

/** Adds an interval in UTC calendar terms (months clamp to the month's last day). */
export function addInterval(from: Date, unit: 'week' | 'month', count: number): Date {
  if (unit === 'week') return new Date(from.getTime() + count * 7 * 86_400_000);
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + count);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Receipt numbers as shown: R-000042. */
export const receiptLabel = (n: number): string => `R-${String(n).padStart(6, '0')}`;
