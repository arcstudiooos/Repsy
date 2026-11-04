import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import type { BillingTx } from './packages';

/**
 * PRD K9: revenue dashboard. Kept separate from `analytics/business.ts` (I7)
 * on purpose — this slice must not edit that file; the parent merges the two
 * views on `/app/analytics/business` when both slices land.
 *
 * Definitions, so the numbers mean one thing everywhere:
 * - MRR counts recurring subscriptions that are active or trialing, at their
 *   current amount, normalised to a month: monthly as-is, weekly x 52 / 12.
 *   One-off sales and payment plans are revenue, not MRR, and are excluded.
 * - Churn (last 30 days) = subscriptions cancelled or ended in the window,
 *   divided by the subscriptions that were active at the window's start
 *   (active now + churned in the window). 0 when there were none.
 * - Average client value = all succeeded payments (net of refunds) divided by
 *   the number of distinct clients who have ever paid. Clients with no
 *   clientId (a buyer who never became a client) count under their email.
 * - Refunds are the sum refunded on payments, not the count of refund calls.
 * All amounts are minor units with one currency per workspace in practice;
 * the dashboard groups by currency rather than converting (no FX rates here).
 */

export interface BillingAnalytics {
  /** Monthly recurring revenue per currency, in minor units. */
  mrrByCurrency: { currency: string; mrrMinor: number }[];
  activeSubscriptions: number;
  trialingSubscriptions: number;
  /** 0-100, over the last 30 days; null when there was nothing to churn from. */
  churnPercent30d: number | null;
  churned30d: number;
  refundsMinor: number;
  refundCount: number;
  /** Net succeeded revenue per paying buyer, in minor units, per currency. */
  averageClientValueByCurrency: { currency: string; averageMinor: number; payingBuyers: number }[];
  /** Gross succeeded revenue per currency, before refunds. */
  revenueByCurrency: { currency: string; grossMinor: number; netMinor: number }[];
}

export interface MonthlyBillingRow {
  month: string;
  /** Succeeded payments issued that month, gross, in minor units. */
  revenueMinor: number;
  currency: string;
  newSubscriptions: number;
  cancelledSubscriptions: number;
}

const DAY = 86_400_000;

/** Pure: a recurring amount normalised to one month of MRR. */
export function monthlyEquivalent(amountMinor: number, interval: string | null): number {
  if (interval === 'week') return Math.round((amountMinor * 52) / 12);
  if (interval === 'month') return amountMinor;
  return 0;
}

/** Pure: the K9 numbers from subscription and payment rows, no database. */
export function computeBillingAnalytics(
  subscriptions: {
    status: string;
    amountMinor: number;
    currency: string;
    interval: string | null;
    cancelledAt: Date | null;
    endsAt: Date | null;
  }[],
  payments: {
    status: string;
    amountMinor: number;
    refundedMinor: number;
    currency: string;
    clientId: string | null;
    customerEmail: string;
    paidAt: Date | null;
    createdAt: Date;
  }[],
  now: Date = new Date(),
): BillingAnalytics {
  const byCurrency = new Map<string, { mrr: number; gross: number; net: number }>();
  const acc = (currency: string) => {
    let row = byCurrency.get(currency);
    if (!row) {
      row = { mrr: 0, gross: 0, net: 0 };
      byCurrency.set(currency, row);
    }
    return row;
  };
  let active = 0;
  let trialing = 0;
  for (const s of subscriptions) {
    if (s.status === 'active') active += 1;
    if (s.status === 'trialing') trialing += 1;
    if (s.status === 'active' || s.status === 'trialing') {
      acc(s.currency).mrr += monthlyEquivalent(s.amountMinor, s.interval);
    }
  }
  const windowStart = new Date(now.getTime() - 30 * DAY);
  const churned = subscriptions.filter(
    (s) =>
      (s.status === 'cancelled' || s.status === 'ended') &&
      s.cancelledAt &&
      s.cancelledAt >= windowStart,
  ).length;
  const churnBase = active + trialing + churned;
  const buyers = new Map<string, { net: number; currency: string }>();
  let refundsMinor = 0;
  let refundCount = 0;
  for (const p of payments) {
    if (p.status !== 'succeeded' && p.status !== 'partially_refunded' && p.status !== 'refunded') {
      continue;
    }
    const row = acc(p.currency);
    row.gross += p.amountMinor;
    row.net += p.amountMinor - p.refundedMinor;
    if (p.refundedMinor > 0) {
      refundsMinor += p.refundedMinor;
      refundCount += 1;
    }
    const key = `${p.currency}:${p.clientId ?? p.customerEmail}`;
    const buyer = buyers.get(key) ?? { net: 0, currency: p.currency };
    buyer.net += p.amountMinor - p.refundedMinor;
    buyers.set(key, buyer);
  }
  const currencies = [...byCurrency.keys()].sort();
  const averageByCurrency = currencies
    .map((currency) => {
      const mine = [...buyers.values()].filter((b) => b.currency === currency);
      if (mine.length === 0) return null;
      const total = mine.reduce((sum, b) => sum + b.net, 0);
      return {
        currency,
        averageMinor: Math.round(total / mine.length),
        payingBuyers: mine.length,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    mrrByCurrency: currencies.map((currency) => ({
      currency,
      mrrMinor: byCurrency.get(currency)!.mrr,
    })),
    activeSubscriptions: active,
    trialingSubscriptions: trialing,
    churnPercent30d: churnBase === 0 ? null : Math.round((churned / churnBase) * 100),
    churned30d: churned,
    refundsMinor,
    refundCount,
    averageClientValueByCurrency: averageByCurrency,
    revenueByCurrency: currencies.map((currency) => ({
      currency,
      grossMinor: byCurrency.get(currency)!.gross,
      netMinor: byCurrency.get(currency)!.net,
    })),
  };
}

/** Pure: monthly revenue rows for the CSV export and the dashboard table. */
export function monthlyBillingRows(
  subscriptions: { createdAt: Date; cancelledAt: Date | null; status: string }[],
  payments: {
    status: string;
    amountMinor: number;
    currency: string;
    paidAt: Date | null;
    createdAt: Date;
  }[],
  months = 12,
  now: Date = new Date(),
): MonthlyBillingRow[] {
  const monthOf = (d: Date) => d.toISOString().slice(0, 7);
  const rows: MonthlyBillingRow[] = [];
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const month = monthOf(d);
    const revenue = payments
      .filter(
        (p) =>
          (p.status === 'succeeded' ||
            p.status === 'partially_refunded' ||
            p.status === 'refunded') &&
          monthOf(p.paidAt ?? p.createdAt) === month,
      )
      .reduce((sum, p) => sum + p.amountMinor, 0);
    const currency =
      payments.find((p) => monthOf(p.paidAt ?? p.createdAt) === month)?.currency ?? '';
    rows.push({
      month,
      revenueMinor: revenue,
      currency,
      newSubscriptions: subscriptions.filter((s) => monthOf(s.createdAt) === month).length,
      cancelledSubscriptions: subscriptions.filter(
        (s) => s.cancelledAt && monthOf(s.cancelledAt) === month,
      ).length,
    });
  }
  return rows;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure: the K9 CSV export. One row per month, plus a totals row. */
export function billingCsv(rows: MonthlyBillingRow[]): string {
  const lines = ['month,revenue_minor,currency,new_subscriptions,cancelled_subscriptions'];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.month),
        csvCell(r.revenueMinor),
        csvCell(r.currency),
        csvCell(r.newSubscriptions),
        csvCell(r.cancelledSubscriptions),
      ].join(','),
    );
  }
  const total = rows.reduce((sum, r) => sum + r.revenueMinor, 0);
  lines.push(['total', total, '', '', ''].join(','));
  return `${lines.join('\n')}\n`;
}

/** Coach reads the revenue dashboard (K9). */
export async function getBillingAnalytics(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<{ summary: BillingAnalytics; monthly: MonthlyBillingRow[] }> {
  assertCan(actor, 'analytics:read');
  const db = tx as unknown as BillingTx;
  const subscriptions = await db.subscription.findMany({});
  const payments = await db.payment.findMany({});
  return {
    summary: computeBillingAnalytics(subscriptions, payments, now),
    monthly: monthlyBillingRows(subscriptions, payments, 12, now),
  };
}
