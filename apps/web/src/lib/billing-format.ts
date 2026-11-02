import { formatMoney } from '@kinetic/core/money';

/** Prices and statuses as coaches and clients read them (PRD K3, K8). Client-safe: no database code. */
export interface PriceShape {
  kind: string;
  amountMinor: number;
  intervalUnit: string | null;
  intervalCount: number | null;
  installments: number | null;
  trialDays?: number;
  accessDays?: number | null;
}

const every = (unit: string | null, count: number | null): string => {
  const u = unit === 'week' ? 'week' : 'month';
  return count && count > 1 ? `every ${count} ${u}s` : `a ${u}`;
};

export function priceLabel(p: PriceShape, currency: string): string {
  const amount = formatMoney(p.amountMinor, currency);
  if (p.kind === 'recurring') return `${amount} ${every(p.intervalUnit, p.intervalCount)}`;
  if (p.kind === 'plan') {
    return `${p.installments ?? 0} payments of ${amount}, ${every(p.intervalUnit, p.intervalCount)}`;
  }
  return p.accessDays ? `${amount} for ${p.accessDays} days` : `${amount} once`;
}

export function trialLabel(p: PriceShape): string | null {
  return p.trialDays && p.trialDays > 0 ? `${p.trialDays}-day free trial` : null;
}

export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for payment',
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Cancelled, ends at period end',
  ended: 'Ended',
  expired: 'Not completed',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  succeeded: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  void: 'Voided',
};

export const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  upi: 'UPI',
  bank: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
};

export const PROVIDER_LABEL: Record<string, string> = {
  stripe: 'Stripe',
  razorpay: 'Razorpay',
  fake: 'Test payments',
  manual: 'Recorded by hand',
};

export function formatDay(iso: string | null, timeZone = 'UTC'): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}
