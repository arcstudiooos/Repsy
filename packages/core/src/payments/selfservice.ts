import { appendAudit, type SystemTx, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toCsv } from '../exports/csv';
import { isUuid } from '../uuid';
import { monthlyValue } from './money';
import type { PaymentsPort, ProviderName } from './port';
import type { AccountOpener } from './purchases';

/**
 * PRD K7-K9 (D-013 #7-#9): the payment gate after a failed payment's grace period, the client's self-service
 * billing links, the revenue figures on business analytics, and expiring checkouts nobody finished.
 */
const DAY = 86_400_000;
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

// ---------------------------------------------------------------- payment gate (K7)

export interface PaymentGate {
  purchaseId: string;
  packageTitle: string;
  pastDueSince: string;
}

/**
 * The past-due purchase that gates this client's portal, if any: past due for longer than the workspace's grace
 * period and not lifted by the coach since it fell past due. Sessions and history are never touched (D-003).
 */
export async function paymentGateFor(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<PaymentGate | null> {
  if (actor.role !== 'client' || !actor.clientId) return null;
  const org = await tx.organization.findFirstOrThrow({ select: { paymentGraceDays: true } });
  const cutoff = new Date(now.getTime() - org.paymentGraceDays * DAY);
  const rows = await tx.purchase.findMany({
    where: { clientId: actor.clientId, status: 'past_due', pastDueSince: { lte: cutoff } },
    orderBy: { pastDueSince: 'asc' },
    select: {
      id: true,
      pastDueSince: true,
      gateLiftedAt: true,
      package: { select: { title: true } },
    },
  });
  const gated = rows.find((r) => !r.gateLiftedAt || r.gateLiftedAt < r.pastDueSince!);
  return gated
    ? {
        purchaseId: gated.id,
        packageTitle: gated.package.title,
        pastDueSince: gated.pastDueSince!.toISOString(),
      }
    : null;
}

/** A trainer lifts the gate for this past-due episode; a later failure raises it again. */
export async function liftPaymentGate(
  tx: TenantTx,
  actor: ActorContext,
  purchaseId: string,
  ctx: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'billing:record');
  if (!isUuid(purchaseId)) throw notFound();
  const now = ctx.now ?? new Date();
  const { count } = await tx.purchase.updateMany({
    where: { id: purchaseId, status: 'past_due' },
    data: { gateLiftedAt: now },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'purchase',
    objectId: purchaseId,
    action: 'purchase.gate_lifted',
    requestId: ctx.requestId,
  });
}

// ---------------------------------------------------------------- self-service (K8)

/**
 * The provider's hosted page where the client updates their card (or a coach opens it for them). Null when the
 * purchase has no provider customer (manual or one-off payments) or the provider has no such page.
 */
export async function billingManageUrl(
  tx: TenantTx,
  actor: ActorContext,
  purchaseId: string,
  deps: {
    portFor(provider: ProviderName): PaymentsPort;
    openAccount: AccountOpener;
    returnUrl: string;
  },
): Promise<string | null> {
  if (actor.role === 'client') assertCan(actor, 'billing:self');
  else assertCan(actor, 'billing:manage');
  if (!isUuid(purchaseId)) throw notFound();
  const p = await tx.purchase.findFirst({
    where: {
      id: purchaseId,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    select: { provider: true, customerRef: true, subscriptionRef: true },
  });
  if (!p) throw notFound();
  if (p.provider === 'manual' || (!p.customerRef && !p.subscriptionRef)) return null;
  const row = await tx.paymentAccount.findFirst({
    where: { provider: p.provider, status: 'active' },
    select: { provider: true, accountRef: true, tokenCiphertext: true },
  });
  if (!row) return null;
  const account = deps.openAccount(row);
  return deps.portFor(account.provider).manageUrl(account, {
    customerRef: p.customerRef,
    subscriptionRef: p.subscriptionRef,
    returnUrl: deps.returnUrl,
  });
}

// ---------------------------------------------------------------- revenue (K9)

export interface RevenueMonth {
  month: string;
  grossMinor: number;
  refundedMinor: number;
  netMinor: number;
  payments: number;
}

export interface RevenueSummary {
  currency: string | null;
  /** Monthly recurring revenue now, in minor units. */
  mrrMinor: number;
  activeSubscriptions: number;
  /** Subscriptions that ended in the last 30 days over those live 30 days ago (0-100), null with none. */
  churnPercent: number | null;
  refundedLast30Minor: number;
  /** Net revenue over the last 12 months per paying client. */
  averageClientValueMinor: number | null;
  monthly: RevenueMonth[];
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const lastMonths = (now: Date, n: number) => {
  const out: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = n - 1; i >= 0; i--) {
    const t = y * 12 + m - i;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }
  return out;
};

/** K9: revenue in the workspace's currency. Manual payments count; voided ones don't. */
export async function getRevenue(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<RevenueSummary> {
  assertCan(actor, 'billing:read');
  const org = await tx.organization.findFirstOrThrow({ select: { currency: true } });
  const months = lastMonths(now, 12);
  const since = new Date(`${months[0]}-01T00:00:00.000Z`);
  const day30 = new Date(now.getTime() - 30 * DAY);

  const recurring = await tx.purchase.findMany({
    where: { package: { kind: { in: ['recurring', 'plan'] } } },
    select: {
      status: true,
      amountMinor: true,
      installmentsPaid: true,
      createdAt: true,
      endedAt: true,
      package: { select: { intervalUnit: true, intervalCount: true, installments: true } },
    },
  });
  let mrrMinor = 0;
  let activeSubscriptions = 0;
  let liveThen = 0;
  let endedSince = 0;
  for (const p of recurring) {
    const unit = p.package.intervalUnit === 'week' ? 'week' : 'month';
    const count = p.package.intervalCount ?? 1;
    // Trials and plans already paid off bring no recurring revenue.
    const paying =
      (p.status === 'active' || p.status === 'past_due' || p.status === 'canceled') &&
      (p.package.installments === null || p.installmentsPaid < p.package.installments);
    if (paying) mrrMinor += monthlyValue(p.amountMinor, unit, count);
    if (['trialing', 'active', 'past_due', 'canceled'].includes(p.status)) activeSubscriptions++;
    const wasStarted = p.status !== 'pending' && p.status !== 'expired' && p.createdAt <= day30;
    if (wasStarted && (!p.endedAt || p.endedAt > day30)) liveThen++;
    if (p.endedAt && p.endedAt > day30 && p.endedAt <= now && p.createdAt <= day30) endedSince++;
  }

  const payments = await tx.payment.findMany({
    where: { status: { in: ['succeeded', 'refunded'] }, paidAt: { gte: since, lte: now } },
    select: {
      clientId: true,
      amountMinor: true,
      refundedMinor: true,
      paidAt: true,
      updatedAt: true,
    },
  });
  const byMonth = new Map(
    months.map((m) => [
      m,
      { month: m, grossMinor: 0, refundedMinor: 0, netMinor: 0, payments: 0 } as RevenueMonth,
    ]),
  );
  const payers = new Set<string>();
  let net = 0;
  let refundedLast30Minor = 0;
  for (const p of payments) {
    const row = byMonth.get(monthOf(p.paidAt));
    if (!row) continue;
    row.grossMinor += p.amountMinor;
    row.refundedMinor += p.refundedMinor;
    row.netMinor += p.amountMinor - p.refundedMinor;
    row.payments++;
    net += p.amountMinor - p.refundedMinor;
    payers.add(p.clientId);
    if (p.refundedMinor > 0 && p.updatedAt >= day30) refundedLast30Minor += p.refundedMinor;
  }
  return {
    currency: org.currency,
    mrrMinor,
    activeSubscriptions,
    churnPercent: liveThen === 0 ? null : Math.round((endedSince / liveThen) * 100),
    refundedLast30Minor,
    averageClientValueMinor: payers.size === 0 ? null : Math.round(net / payers.size),
    monthly: [...byMonth.values()],
  };
}

/** K9: the monthly revenue table as CSV, amounts in major units. */
export function revenueCsv(r: RevenueSummary, digits: number): string {
  const major = (n: number) => (n / 10 ** digits).toFixed(digits);
  return toCsv(
    ['month', 'currency', 'payments', 'gross', 'refunded', 'net'],
    r.monthly.map((m) => [
      m.month,
      r.currency ?? '',
      m.payments,
      major(m.grossMinor),
      major(m.refundedMinor),
      major(m.netMinor),
    ]),
  );
}

// ---------------------------------------------------------------- housekeeping

/**
 * Checkouts left unfinished for a day expire, so they never count or block anything, and give back the coupon use
 * they reserved (system sweep). A late payment still activates an expired purchase.
 */
export async function expireStalePurchases(tx: SystemTx, now: Date = new Date()): Promise<number> {
  const stale = await tx.purchase.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - DAY) } },
    select: { id: true, couponId: true },
    take: 1000,
  });
  let expired = 0;
  for (const p of stale) {
    const { count } = await tx.purchase.updateMany({
      where: { id: p.id, status: 'pending' },
      data: { status: 'expired' },
    });
    if (count === 0) continue;
    expired++;
    if (p.couponId) {
      await tx.coupon.updateMany({
        where: { id: p.couponId, uses: { gt: 0 } },
        data: { uses: { decrement: 1 } },
      });
    }
  }
  return expired;
}
