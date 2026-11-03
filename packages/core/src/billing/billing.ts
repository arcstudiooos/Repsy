import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';
import { fakePaymentsProvider, type PaymentsPort, type ProviderKind } from './payments';
import { nextChargeDate } from './packages';
import type { BillingTx } from './packages';

/**
 * PRD K6, K7, K8, K15: subscriptions, failed payments, billing self-service,
 * manual payments and receipts.
 *
 * Rules that matter:
 * - A failed payment retries on a fixed schedule (1, 3, then 7 days) and the
 *   client is emailed each time through the existing outbox, so the email
 *   commits or rolls back with the failure record. After the last retry the
 *   subscription becomes a "Needs review" item for the coach; it never silently
 *   cancels (PRD P4: no surprise billing, and no surprise cancellation).
 * - A grace period is optional per subscription. While it runs, access stays
 *   on; only when it expires does access pause. Pausing is reversible: a
 *   successful retry restores the subscription.
 * - Cancelling is one click and the end date is shown at once: a recurring
 *   subscription runs to the end of its current period; a payment plan stops
 *   after the installments already paid; nothing is charged again.
 * - A receipt is branded with the workspace name, accent and logo (the same
 *   branding the portal uses), and carries the tax line from K6.
 *
 * DB functions use the `BillingTx` shape from packages.ts (schema snippet).
 */

export const SUBSCRIPTION_STATUSES = [
  'pending',
  'trialing',
  'active',
  'past_due',
  'grace',
  'paused',
  'cancelled',
  'ended',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Days after each failed attempt before the next retry; then "Needs review". */
export const RETRY_DELAY_DAYS = [1, 3, 7] as const;

export interface SubscriptionView {
  id: string;
  packageTitle: string;
  status: SubscriptionStatus;
  amountMinor: number;
  currency: string;
  interval: string | null;
  installments: number | null;
  installmentsPaid: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
  /** Shown at once on cancel; null while the subscription is still running. */
  endsAt: string | null;
  graceEndsAt: string | null;
  needsReview: boolean;
}

export interface ReceiptView {
  id: string;
  paymentId: string;
  number: string;
  orgName: string;
  brandAccent: string | null;
  logoUrl: string | null;
  customerEmail: string;
  description: string;
  amountMinor: number;
  taxMinor: number;
  taxRateBps: number;
  currency: string;
  issuedAt: string;
}

export interface SelfServiceView {
  subscription: SubscriptionView | null;
  /** Link to the provider portal for updating the card (fake test URL). */
  portalUrl: string | null;
  receipts: ReceiptView[];
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const billingTx = (tx: TenantTx): BillingTx => tx as unknown as BillingTx;

/**
 * No billing action exists in policies.ts yet, and this slice must not edit
 * it. Staff paths use `client:update`; a client acting on their own billing
 * reuses an existing client-permitted action (`session:read` for reads,
 * `session:log` for cancel) and core still scopes every read/write to their
 * own subscription. The parent may add a dedicated `billing:manage` action
 * later; these two lines are the only place that changes (see D-013).
 */
function assertBillingRead(actor: ActorContext): void {
  if (actor.role === 'client') assertCan(actor, 'session:read');
  else assertCan(actor, 'client:update');
}

function assertBillingWrite(actor: ActorContext): void {
  if (actor.role === 'client') assertCan(actor, 'session:log');
  else assertCan(actor, 'client:update');
}

/**
 * The API layer sets `actor.clientId` for clients; server pages (via
 * `withServerTenant`) do not. Resolve the caller's own client row by user id
 * so the self-service page works from either path. Never resolves another
 * client's row: the lookup is always by the actor's own user id.
 */
async function ownClientId(tx: TenantTx, actor: ActorContext): Promise<string | null> {
  if (actor.clientId) return actor.clientId;
  if (actor.role !== 'client') return null;
  const row = await billingTx(tx).client?.findFirst?.({
    where: { userId: actor.userId },
    select: { id: true },
  });
  return (row?.id as string | undefined) ?? null;
}

/** Pure: when a retry happens after attempt N (0-based), or null when out of retries. */
export function nextRetryAt(failedAt: Date, attempt: number): Date | null {
  if (attempt < 0 || attempt >= RETRY_DELAY_DAYS.length) return null;
  return new Date(failedAt.getTime() + RETRY_DELAY_DAYS[attempt]! * 86_400_000);
}

/** Pure: when a grace period ends, or null when there is no grace period. */
export function gracePeriodEnd(lastFailedAt: Date, graceDays: number): Date | null {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw invalid('graceDays', 'A grace period is 0 days or more.');
  }
  if (graceDays === 0) return null;
  return new Date(lastFailedAt.getTime() + graceDays * 86_400_000);
}

/** Pure: whether the client's access is paused right now. */
export function accessPaused(
  sub: { status: SubscriptionStatus; graceEndsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (sub.status === 'paused' || sub.status === 'ended') return true;
  if (sub.status === 'grace' && sub.graceEndsAt && sub.graceEndsAt <= now) return true;
  return false;
}

/** Pure: the date coaching paid for by this subscription ends after cancelling. */
export function cancellationEndDate(sub: {
  status: SubscriptionStatus;
  interval: string | null;
  installments: number | null;
  installmentsPaid: number;
  currentPeriodEnd: Date | null;
  nextChargeAt: Date | null;
  trialEndsAt: Date | null;
}): Date | null {
  if (sub.status === 'trialing' && sub.trialEndsAt) return sub.trialEndsAt;
  if (sub.interval) return sub.currentPeriodEnd;
  if (sub.installments !== null) {
    // A plan stops after what was paid; the next charge never happens.
    return sub.installmentsPaid > 0 ? sub.nextChargeAt : null;
  }
  return sub.currentPeriodEnd;
}

function subscriptionView(row: {
  id: string;
  package: { title: string } | null;
  status: string;
  amountMinor: number;
  currency: string;
  interval: string | null;
  installments: number | null;
  installmentsPaid: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  nextChargeAt: Date | null;
  endsAt: Date | null;
  graceEndsAt: Date | null;
  needsReview: boolean;
}): SubscriptionView {
  return {
    id: row.id,
    packageTitle: row.package?.title ?? 'Package',
    status: row.status as SubscriptionStatus,
    amountMinor: row.amountMinor,
    currency: row.currency,
    interval: row.interval,
    installments: row.installments,
    installmentsPaid: row.installmentsPaid,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    nextChargeAt: row.nextChargeAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
    needsReview: row.needsReview,
  };
}

function receiptView(
  row: {
    id: string;
    paymentId: string;
    number: string;
    customerEmail: string;
    description: string;
    amountMinor: number;
    taxMinor: number;
    taxRateBps: number;
    currency: string;
    issuedAt: Date;
  },
  org: { name: string; brandAccent: string | null; logoUrl: string | null },
): ReceiptView {
  return {
    id: row.id,
    paymentId: row.paymentId,
    number: row.number,
    orgName: org.name,
    brandAccent: org.brandAccent,
    logoUrl: org.logoUrl,
    customerEmail: row.customerEmail,
    description: row.description,
    amountMinor: row.amountMinor,
    taxMinor: row.taxMinor,
    taxRateBps: row.taxRateBps,
    currency: row.currency,
    issuedAt: row.issuedAt.toISOString(),
  };
}

/** Coach lists subscriptions, optionally only the ones needing review (K7). */
export async function listSubscriptions(
  tx: TenantTx,
  actor: ActorContext,
  opts: { needsReview?: boolean } = {},
): Promise<SubscriptionView[]> {
  assertCan(actor, 'client:update');
  const db = billingTx(tx);
  const rows = await db.subscription.findMany({
    where: opts.needsReview ? { needsReview: true } : {},
    orderBy: [{ updatedAt: 'desc' }],
    include: { package: { select: { title: true } } },
  });
  return rows.map(subscriptionView);
}

/**
 * Demo stand-in for a verified provider webhook (K4). Marks a pending
 * subscription/payment as paid, consumes one coupon use, and issues a branded
 * receipt. In production this must only run from a verified webhook, never
 * from a client request — the API route for it is deliberately coach-only and
 * labelled as a test confirmation.
 */
export async function confirmCheckout(
  tx: TenantTx,
  actor: ActorContext,
  input: { subscriptionId?: unknown; paymentId?: unknown },
  now: Date = new Date(),
): Promise<{ receiptId: string | null }> {
  assertCan(actor, 'client:update');
  const db = billingTx(tx);
  const org = await tx.organization.findFirstOrThrow({
    select: { name: true, brandAccent: true, logoUrl: true },
  });
  let payment: {
    id: string;
    customerEmail: string;
    amountMinor: number;
    taxMinor: number;
    taxRateBps: number;
    currency: string;
    couponId: string | null;
    packageId: string | null;
  } | null = null;
  if (typeof input.subscriptionId === 'string' && isUuid(input.subscriptionId)) {
    const sub = await db.subscription.findFirst({ where: { id: input.subscriptionId } });
    if (!sub) throw notFound();
    if (sub.status !== 'pending' && sub.status !== 'trialing') {
      throw new DomainError('CONFLICT', 'This purchase is already confirmed.');
    }
    const pkg = await db.billingPackage.findFirst({ where: { id: sub.packageId } });
    await db.subscription.updateMany({
      where: { id: sub.id },
      data: {
        status: sub.trialEndsAt ? 'trialing' : 'active',
        currentPeriodStart: now,
      },
    });
    payment = await db.payment.create({
      data: {
        packageId: sub.packageId,
        clientId: sub.clientId,
        customerEmail: sub.customerEmail,
        provider: sub.provider,
        amountMinor: sub.trialEndsAt ? 0 : sub.amountMinor,
        taxMinor: sub.trialEndsAt ? 0 : (sub.taxMinor ?? 0),
        taxRateBps: sub.taxRateBps ?? 0,
        currency: sub.currency,
        status: 'succeeded',
        kind: sub.installments !== null ? 'payment_plan' : 'recurring',
        subscriptionId: sub.id,
        couponId: sub.couponId,
        providerChargeId: `ch_fake_confirm_${sub.id.slice(0, 8)}`,
      },
      select: {
        id: true,
        customerEmail: true,
        amountMinor: true,
        taxMinor: true,
        taxRateBps: true,
        currency: true,
        couponId: true,
        packageId: true,
      },
    });
    if (sub.couponId) {
      await db.coupon.updateMany({
        where: { id: sub.couponId },
        data: { usedCount: { increment: 1 } },
      });
    }
    void pkg;
  } else if (typeof input.paymentId === 'string' && isUuid(input.paymentId)) {
    const existing = await db.payment.findFirst({ where: { id: input.paymentId } });
    if (!existing) throw notFound();
    if (existing.status !== 'pending') {
      throw new DomainError('CONFLICT', 'This payment is already confirmed.');
    }
    await db.payment.updateMany({
      where: { id: existing.id },
      data: { status: 'succeeded', paidAt: now },
    });
    payment = existing;
    if (existing.couponId) {
      await db.coupon.updateMany({
        where: { id: existing.couponId },
        data: { usedCount: { increment: 1 } },
      });
    }
  } else {
    throw notFound();
  }
  if (!payment) throw notFound();
  const receipt = await db.receipt.create({
    data: {
      paymentId: payment.id,
      number: `R-${now.getUTCFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`,
      customerEmail: payment.customerEmail,
      description: 'Coaching package',
      amountMinor: payment.amountMinor,
      taxMinor: payment.taxMinor,
      taxRateBps: payment.taxRateBps,
      currency: payment.currency,
      issuedAt: now,
    },
    select: { id: true },
  });
  void org;
  return { receiptId: receipt.id as string };
}

/**
 * Records a failed payment (K7): the payment is marked failed, the
 * subscription retries or becomes "Needs review", the client is emailed via
 * the outbox (same transaction), and an optional grace period keeps access on.
 * Returns the next retry date, or null when there are no retries left.
 */
export async function handleFailedPayment(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    subscriptionId?: unknown;
    paymentId?: unknown;
    reason?: unknown;
    graceDays?: unknown;
  },
  now: Date = new Date(),
): Promise<{ nextRetryAt: string | null; needsReview: boolean; graceEndsAt: string | null }> {
  assertCan(actor, 'client:update');
  const db = billingTx(tx);
  const reason =
    typeof input.reason === 'string' && input.reason.trim() !== ''
      ? input.reason.trim().slice(0, 200)
      : 'Payment failed.';
  const graceDays =
    input.graceDays === undefined || input.graceDays === null
      ? 0
      : (() => {
          const n = Number(input.graceDays);
          if (!Number.isInteger(n) || n < 0 || n > 90) {
            throw invalid('graceDays', 'A grace period is 0 to 90 days.');
          }
          return n;
        })();
  if (typeof input.paymentId === 'string' && isUuid(input.paymentId)) {
    await db.payment.updateMany({
      where: { id: input.paymentId },
      data: { status: 'failed', failureReason: reason },
    });
  }
  if (typeof input.subscriptionId !== 'string' || !isUuid(input.subscriptionId)) {
    throw notFound();
  }
  const sub = await db.subscription.findFirst({ where: { id: input.subscriptionId } });
  if (!sub) throw notFound();
  const attempt = (sub.failedAttempts as number) + 1;
  const retry = nextRetryAt(now, attempt - 1);
  const graceEnds = gracePeriodEnd(now, graceDays);
  const needsReview = retry === null;
  await db.subscription.updateMany({
    where: { id: sub.id },
    data: {
      status: needsReview ? 'past_due' : graceEnds ? 'grace' : 'past_due',
      failedAttempts: attempt,
      nextRetryAt: retry,
      graceEndsAt: graceEnds,
      needsReview,
    },
  });
  await enqueueEmail(tx, {
    toEmail: sub.customerEmail as string,
    kind: 'billing_payment_failed',
    templateKey: 'billing_payment_failed',
    payload: {
      reason,
      nextRetryAt: retry?.toISOString() ?? null,
      needsReview,
    },
    idempotencyKey: `billing-failed-${sub.id}-${attempt}`,
  });
  return {
    nextRetryAt: retry?.toISOString() ?? null,
    needsReview,
    graceEndsAt: graceEnds?.toISOString() ?? null,
  };
}

/** Worker/coach step: pause access for subscriptions whose grace has expired (K7). */
export async function applyGraceExpiry(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<{ paused: number }> {
  assertCan(actor, 'client:update');
  const { count } = await billingTx(tx).subscription.updateMany({
    where: { status: 'grace', graceEndsAt: { lte: now } },
    data: { status: 'paused', needsReview: true },
  });
  return { paused: count };
}

/**
 * Retries a past-due subscription through the fake provider (K7). A success
 * restores it to active and advances the period; a failure re-runs the
 * failed-payment path. Real retries belong in the worker, not in a request.
 */
export async function retrySubscriptionPayment(
  tx: TenantTx,
  actor: ActorContext,
  subscriptionId: string,
  payments?: PaymentsPort,
  now: Date = new Date(),
): Promise<{ status: SubscriptionStatus }> {
  assertCan(actor, 'client:update');
  if (!isUuid(subscriptionId)) throw notFound();
  const db = billingTx(tx);
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId } });
  if (!sub) throw notFound();
  if (sub.status !== 'past_due' && sub.status !== 'grace' && sub.status !== 'paused') {
    throw new DomainError('CONFLICT', 'Only a past-due subscription can be retried.');
  }
  const provider = payments ?? fakePaymentsProvider(sub.provider as ProviderKind);
  const charge = await provider.createCharge({
    providerAccountId: `org_${actor.orgId}`,
    customerEmail: sub.customerEmail as string,
    amount: { amountMinor: sub.amountMinor as number, currency: sub.currency as string },
    description: 'Subscription retry',
    idempotencyKey: `retry-${sub.id}-${sub.failedAttempts}`,
  });
  if (charge.status !== 'succeeded') {
    await handleFailedPayment(
      tx,
      actor,
      { subscriptionId: sub.id, reason: charge.failureReason ?? 'Payment failed.' },
      now,
    );
    return { status: 'past_due' };
  }
  const interval = sub.interval as 'week' | 'month' | null;
  await db.subscription.updateMany({
    where: { id: sub.id },
    data: {
      status: 'active',
      failedAttempts: 0,
      nextRetryAt: null,
      graceEndsAt: null,
      needsReview: false,
      installmentsPaid:
        sub.installments !== null ? (sub.installmentsPaid as number) + 1 : sub.installmentsPaid,
      currentPeriodStart: now,
      currentPeriodEnd: interval ? nextChargeDate(now, interval) : sub.currentPeriodEnd,
      nextChargeAt: interval ? nextChargeDate(now, interval) : null,
    },
  });
  return { status: 'active' };
}

/**
 * One-click cancel (K8). The end date is computed and stored at once, so the
 * client sees it immediately and is never charged again. No refund is issued
 * here: refunds are a separate coach action (see refundPayment).
 */
export async function cancelSubscription(
  tx: TenantTx,
  actor: ActorContext,
  subscriptionId: string,
  now: Date = new Date(),
): Promise<{ endsAt: string | null }> {
  assertBillingWrite(actor);
  if (!isUuid(subscriptionId)) throw notFound();
  const db = billingTx(tx);
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId } });
  if (!sub) throw notFound();
  // A client may only cancel their own subscription; staff may cancel any.
  const mine = await ownClientId(tx, actor);
  if (actor.role === 'client' && sub.clientId !== mine) {
    throw notFound();
  }
  if (sub.status === 'cancelled' || sub.status === 'ended') {
    return { endsAt: (sub.endsAt as Date | null)?.toISOString() ?? null };
  }
  const endsAt = cancellationEndDate({
    status: sub.status as SubscriptionStatus,
    interval: sub.interval as string | null,
    installments: sub.installments as number | null,
    installmentsPaid: sub.installmentsPaid as number,
    currentPeriodEnd: sub.currentPeriodEnd as Date | null,
    nextChargeAt: sub.nextChargeAt as Date | null,
    trialEndsAt: sub.trialEndsAt as Date | null,
  });
  await db.subscription.updateMany({
    where: { id: sub.id },
    data: { status: 'cancelled', endsAt, cancelledAt: now },
  });
  return { endsAt: endsAt?.toISOString() ?? null };
}

/** Coach refunds a succeeded payment, in full or in part (K9 counts it). */
export async function refundPayment(
  tx: TenantTx,
  actor: ActorContext,
  input: { paymentId?: unknown; amountMinor?: unknown },
  payments?: PaymentsPort,
): Promise<{ refundedMinor: number }> {
  assertCan(actor, 'client:update');
  if (typeof input.paymentId !== 'string' || !isUuid(input.paymentId)) throw notFound();
  const amount = Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw invalid('amountMinor', 'Refund a whole number of cents or paise above 0.');
  }
  const db = billingTx(tx);
  const payment = await db.payment.findFirst({ where: { id: input.paymentId } });
  if (!payment) throw notFound();
  if (payment.status !== 'succeeded') {
    throw new DomainError('CONFLICT', 'Only a succeeded payment can be refunded.');
  }
  const already = (payment.refundedMinor as number) ?? 0;
  if (already + amount > (payment.amountMinor as number)) {
    throw new DomainError('CONFLICT', 'That refund is more than the payment.');
  }
  const provider = payments ?? fakePaymentsProvider(payment.provider as ProviderKind);
  const result = payment.providerChargeId
    ? await provider.refundCharge(payment.providerChargeId as string, amount)
    : { providerRefundId: `re_fake_manual_${payment.id.slice(0, 8)}`, refundedMinor: amount };
  await db.payment.updateMany({
    where: { id: payment.id },
    data: {
      refundedMinor: already + result.refundedMinor,
      status:
        already + result.refundedMinor >= (payment.amountMinor as number)
          ? 'refunded'
          : 'partially_refunded',
    },
  });
  return { refundedMinor: result.refundedMinor };
}

/** Client billing self-service (K8): their plan, next charge, receipts, portal link. */
export async function getBillingSelfService(
  tx: TenantTx,
  actor: ActorContext,
  payments?: PaymentsPort,
): Promise<SelfServiceView> {
  assertBillingRead(actor);
  const db = billingTx(tx);
  const org = await tx.organization.findFirstOrThrow({
    select: { name: true, brandAccent: true, logoUrl: true },
  });
  // A signed-in client is always scoped to their own record, resolved from
  // actor.clientId (API) or their user id (server pages). Staff without a
  // client record see the empty shape.
  const clientId = await ownClientId(tx, actor);
  const sub = clientId
    ? await db.subscription.findFirst({
        where: { clientId, status: { notIn: ['ended'] } },
        orderBy: [{ updatedAt: 'desc' }],
        include: { package: { select: { title: true } } },
      })
    : null;
  const receipts = clientId
    ? await db.receipt.findMany({
        where: { payment: { is: { clientId } } },
        orderBy: [{ issuedAt: 'desc' }],
        take: 50,
      })
    : [];
  const provider = payments ?? fakePaymentsProvider('stripe');
  const portal = sub
    ? await provider.createPortalSession({
        providerCustomerId: `cus_fake_${clientId ?? 'anon'}`,
        returnUrl: '/app/billing/self-service',
      })
    : null;
  return {
    subscription: sub ? subscriptionView(sub) : null,
    portalUrl: portal?.url ?? null,
    receipts: receipts.map(
      (r: {
        id: string;
        paymentId: string;
        number: string;
        customerEmail: string;
        description: string;
        amountMinor: number;
        taxMinor: number;
        taxRateBps: number;
        currency: string;
        issuedAt: Date;
      }) => receiptView(r, org),
    ),
  };
}

/**
 * Manual payments (K15): cash or a bank transfer recorded against a package,
 * for coaches who don't use online payments. No provider is involved, so no
 * provider charge id exists; the receipt is still branded and still counts
 * in revenue (K9) like any succeeded payment.
 */
export async function recordManualPayment(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    packageId?: unknown;
    clientId?: unknown;
    customerEmail?: unknown;
    amountMinor?: unknown;
    currency?: unknown;
    method?: unknown;
    reference?: unknown;
    paidAt?: unknown;
  },
  now: Date = new Date(),
): Promise<{ paymentId: string; receiptId: string }> {
  assertCan(actor, 'client:update');
  if (!isUuid(input.packageId)) throw notFound();
  const db = billingTx(tx);
  const pkg = await db.billingPackage.findFirst({
    where: { id: input.packageId, active: true },
  });
  if (!pkg) throw notFound();
  const amount = Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw invalid('amountMinor', 'Record a whole number of cents or paise above 0.');
  }
  if (input.method !== 'cash' && input.method !== 'bank_transfer') {
    throw invalid('method', 'Pick cash or bank transfer.');
  }
  const email = typeof input.customerEmail === 'string' ? input.customerEmail.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalid('customerEmail', 'Enter an email address.');
  }
  const paidAt =
    input.paidAt !== undefined && input.paidAt !== null ? new Date(input.paidAt as string) : now;
  if (Number.isNaN(paidAt.getTime())) throw invalid('paidAt', 'Pick a date.');
  const payment = await db.payment.create({
    data: {
      packageId: pkg.id,
      clientId:
        typeof input.clientId === 'string' && isUuid(input.clientId) ? input.clientId : null,
      customerEmail: email,
      provider: 'manual',
      amountMinor: amount,
      taxMinor: 0,
      taxRateBps: 0,
      currency:
        typeof input.currency === 'string'
          ? input.currency.toUpperCase()
          : (pkg.currency as string),
      status: 'succeeded',
      kind: 'manual',
      method: input.method,
      reference: typeof input.reference === 'string' ? input.reference.trim().slice(0, 120) : null,
      paidAt,
    },
    select: { id: true },
  });
  const receipt = await db.receipt.create({
    data: {
      paymentId: payment.id as string,
      number: `R-${paidAt.getUTCFullYear()}-${(payment.id as string).slice(0, 8).toUpperCase()}`,
      customerEmail: email,
      description: `${pkg.title as string} (manual payment)`,
      amountMinor: amount,
      taxMinor: 0,
      taxRateBps: 0,
      currency:
        typeof input.currency === 'string'
          ? input.currency.toUpperCase()
          : (pkg.currency as string),
      issuedAt: paidAt,
    },
    select: { id: true },
  });
  return { paymentId: payment.id as string, receiptId: receipt.id as string };
}

/** Branded receipt for one payment (K6), for the coach page and self-service. */
export async function getReceipt(
  tx: TenantTx,
  actor: ActorContext,
  receiptId: string,
): Promise<ReceiptView> {
  assertBillingRead(actor);
  if (!isUuid(receiptId)) throw notFound();
  const row = await billingTx(tx).receipt.findFirst({
    where: { id: receiptId },
    include: { payment: { select: { clientId: true } } },
  });
  if (!row) throw notFound();
  if (actor.role === 'client' && row.payment?.clientId !== (await ownClientId(tx, actor))) {
    throw notFound();
  }
  const org = await tx.organization.findFirstOrThrow({
    select: { name: true, brandAccent: true, logoUrl: true },
  });
  return receiptView(row, org);
}
