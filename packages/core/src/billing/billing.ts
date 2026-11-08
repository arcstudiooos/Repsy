import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';
import {
  assertOnlinePayments,
  defaultPaymentsProvider,
  fakePaymentsProvider,
  onlinePaymentsAvailable,
  type PaymentsPort,
  type ProviderKind,
} from './payments';
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

/**
 * Whether a client's coaching is paused for non-payment (K7): at least one of their subscriptions is paused (or its
 * grace period has run out) and none still gives access. A client with no subscriptions (a coach not using payments)
 * is never paused. Read in the client's tenant scope; no actor, the portal gate calls it for the signed-in client.
 */
export async function clientBillingPaused(
  tx: TenantTx,
  clientId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const subs: { status: SubscriptionStatus; graceEndsAt: Date | null }[] = await billingTx(
    tx,
  ).subscription.findMany({
    where: { clientId, status: { notIn: ['pending', 'cancelled'] } },
    select: { status: true, graceEndsAt: true },
  });
  if (subs.length === 0) return false;
  const paused = subs.filter((s) => accessPaused(s, now));
  return paused.length > 0 && paused.length === subs.length;
}

/**
 * Pure: what one successful charge does to a subscription (K3, K7). A recurring package starts a new period of its
 * interval. A payment plan counts the installment and covers one month (installments are monthly); after the last
 * one there is no next charge. Anything else has no period.
 */
export function periodAfterCharge(
  sub: { interval: string | null; installments: number | null; installmentsPaid: number },
  now: Date,
): {
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  nextChargeAt: Date | null;
  installmentsPaid: number;
} {
  if (sub.interval === 'week' || sub.interval === 'month') {
    const end = nextChargeDate(now, sub.interval);
    return {
      currentPeriodStart: now,
      currentPeriodEnd: end,
      nextChargeAt: end,
      installmentsPaid: sub.installmentsPaid,
    };
  }
  if (sub.installments !== null) {
    const paid = sub.installmentsPaid + 1;
    const end = nextChargeDate(now, 'month');
    return {
      currentPeriodStart: now,
      currentPeriodEnd: end,
      nextChargeAt: paid < sub.installments ? end : null,
      installmentsPaid: paid,
    };
  }
  return {
    currentPeriodStart: now,
    currentPeriodEnd: null,
    nextChargeAt: null,
    installmentsPaid: sub.installmentsPaid,
  };
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
    // A plan stops after what was paid: coaching runs to the end of the last paid month; the next charge never
    // happens.
    return sub.installmentsPaid > 0 ? sub.currentPeriodEnd : null;
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
  assertOnlinePayments();
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
  let purchase: { packageId: string; clientId: string | null; renewsAt: Date | null } | null = null;
  if (typeof input.subscriptionId === 'string' && isUuid(input.subscriptionId)) {
    // No raw SQL in TenantTx: a no-op UPDATE takes the row lock, so two confirms of one purchase run one at a time.
    const locked = await db.subscription.updateMany({
      where: { id: input.subscriptionId },
      data: { updatedAt: now },
    });
    if (locked.count === 0) throw notFound();
    const sub = await db.subscription.findFirst({ where: { id: input.subscriptionId } });
    if (!sub) throw notFound();
    if (sub.status !== 'pending' && sub.status !== 'trialing') {
      throw new DomainError('CONFLICT', 'This purchase is already confirmed.');
    }
    // A trial is created as `trialing` and stays `trialing` once confirmed, so the status alone cannot tell a
    // confirmed trial from an unconfirmed one: an existing payment can.
    const confirmed = await db.payment.findFirst({
      where: { subscriptionId: sub.id },
      select: { id: true },
    });
    if (confirmed) throw new DomainError('CONFLICT', 'This purchase is already confirmed.');
    // A trial keeps the dates set at checkout (the first charge is at the trial's end); a paid start begins its
    // first period now, so the next charge is one period away, not at once.
    const trial = Boolean(sub.trialEndsAt);
    await db.subscription.updateMany({
      where: { id: sub.id },
      data: trial
        ? { status: 'trialing', currentPeriodStart: now }
        : { status: 'active', ...periodAfterCharge(sub, now) },
    });
    payment = await db.payment.create({
      data: {
        packageId: sub.packageId,
        clientId: sub.clientId,
        customerEmail: sub.customerEmail,
        provider: sub.provider,
        amountMinor: trial ? 0 : sub.amountMinor,
        taxMinor: trial ? 0 : (sub.taxMinor ?? 0),
        taxRateBps: sub.taxRateBps ?? 0,
        currency: sub.currency,
        status: 'succeeded',
        paidAt: now,
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
    purchase = {
      packageId: sub.packageId as string,
      clientId: sub.clientId as string | null,
      renewsAt: !sub.interval
        ? null
        : trial
          ? ((sub.currentPeriodEnd as Date | null) ?? null)
          : periodAfterCharge(sub, now).currentPeriodEnd,
    };
  } else if (typeof input.paymentId === 'string' && isUuid(input.paymentId)) {
    const existing = await db.payment.findFirst({ where: { id: input.paymentId } });
    if (!existing) throw notFound();
    // Conditional update: of two concurrent confirms, only one flips `pending` to `succeeded`.
    const flipped = await db.payment.updateMany({
      where: { id: existing.id, status: 'pending' },
      data: { status: 'succeeded', paidAt: now },
    });
    if (flipped.count === 0) {
      throw new DomainError('CONFLICT', 'This payment is already confirmed.');
    }
    payment = existing;
    purchase = existing.packageId
      ? {
          packageId: existing.packageId as string,
          clientId: existing.clientId as string | null,
          renewsAt: null,
        }
      : null;
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
  if (purchase) await startPurchaseJourneys(tx, actor, purchase, now);
  return { receiptId: receipt.id as string };
}

/**
 * J4/J6 on purchase: starts the package's onboarding sequence and, for a recurring package, schedules the renewal
 * reminder for the end of the first period. Only for a purchase tied to a client record. Runs in the confirm
 * transaction, so a broken onboarding setup rolls the confirmation back rather than half-applying it.
 */
async function startPurchaseJourneys(
  tx: TenantTx,
  actor: ActorContext,
  purchase: { packageId: string; clientId: string | null; renewsAt: Date | null },
  now: Date,
): Promise<void> {
  if (!purchase.clientId) return;
  const pkg = await billingTx(tx).billingPackage.findFirst({
    where: { id: purchase.packageId },
    select: { onboardingSequence: true, renewalReminderDays: true },
  });
  if (!pkg) return;
  const { scheduleRenewalReminders, startPackageOnboarding } =
    await import('../scheduling/journeys');
  if (pkg.onboardingSequence !== null && pkg.onboardingSequence !== undefined) {
    const running = await billingTx(tx).packageJourneyRun?.findFirst?.({
      where: { packageId: purchase.packageId, clientId: purchase.clientId },
      select: { id: true },
    });
    if (!running) {
      await startPackageOnboarding(
        tx,
        actor,
        { packageId: purchase.packageId, clientId: purchase.clientId },
        { now },
      );
    }
  }
  if (purchase.renewsAt && (pkg.renewalReminderDays as number) > 0) {
    await scheduleRenewalReminders(
      tx,
      actor,
      {
        packageId: purchase.packageId,
        clientId: purchase.clientId,
        endsAt: purchase.renewsAt.toISOString(),
      },
      { now },
    );
  }
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
  return recordPaymentFailure(tx, input, now);
}

/** `handleFailedPayment` without the actor check: shared by the coach action and the worker's retries. */
async function recordPaymentFailure(
  tx: TenantTx,
  input: {
    subscriptionId?: unknown;
    paymentId?: unknown;
    reason?: unknown;
    graceDays?: unknown;
  },
  now: Date,
): Promise<{ nextRetryAt: string | null; needsReview: boolean; graceEndsAt: string | null }> {
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
  // A cancelled or ended subscription is never charged again, so it cannot fail again either (and must not be
  // reopened as past due).
  if (sub.status === 'cancelled' || sub.status === 'ended') {
    throw new DomainError('CONFLICT', 'This subscription is no longer charged.');
  }
  const attempt = (sub.failedAttempts as number) + 1;
  const retry = nextRetryAt(now, attempt - 1);
  // A grace period already running keeps its end date when a later retry fails without a new one.
  const running = sub.graceEndsAt as Date | null;
  const graceEnds =
    input.graceDays === undefined && running && running > now
      ? running
      : gracePeriodEnd(now, graceDays);
  const needsReview = retry === null;
  await db.subscription.updateMany({
    where: { id: sub.id },
    data: {
      // Access ends at the later of the last retry and the grace period: out of retries with no grace left, the
      // subscription is paused (and waits for the coach in "Needs review"); with grace left it pauses when that ends.
      status: graceEnds && graceEnds > now ? 'grace' : needsReview ? 'paused' : 'past_due',
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
  return expireGraces(tx, now);
}

/**
 * Worker sweep (K7): pauses every subscription in the transaction's organization whose grace period has ended and
 * marks it "Needs review". No actor: the worker runs it per organization in that organization's tenant scope.
 */
export async function expireGraces(
  tx: TenantTx,
  now: Date = new Date(),
): Promise<{ paused: number }> {
  const { count } = await billingTx(tx).subscription.updateMany({
    where: { status: 'grace', graceEndsAt: { lte: now } },
    data: { status: 'paused', needsReview: true },
  });
  return { paused: count };
}

/**
 * Worker sweep (K7): retries one subscription whose retry date has arrived. Re-checks under the row lock, so a coach's
 * manual retry and the sweep never charge twice; returns null when it was no longer due.
 */
export async function retryDueSubscription(
  tx: TenantTx,
  orgId: string,
  subscriptionId: string,
  payments?: PaymentsPort,
  now: Date = new Date(),
): Promise<{ status: SubscriptionStatus } | null> {
  if (!isUuid(subscriptionId)) return null;
  const db = billingTx(tx);
  await db.subscription.updateMany({ where: { id: subscriptionId }, data: { updatedAt: now } });
  const due = await db.subscription.findFirst({
    where: {
      id: subscriptionId,
      status: { in: ['past_due', 'grace'] },
      needsReview: false,
      nextRetryAt: { lte: now },
    },
    select: { id: true },
  });
  if (!due) return null;
  return chargeRetry(tx, orgId, subscriptionId, payments, now);
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
  // Row lock first (no raw SQL in TenantTx): a manual retry and the worker's retry run one at a time.
  await billingTx(tx).subscription.updateMany({
    where: { id: subscriptionId },
    data: { updatedAt: now },
  });
  return chargeRetry(tx, actor.orgId, subscriptionId, payments, now);
}

async function chargeRetry(
  tx: TenantTx,
  orgId: string,
  subscriptionId: string,
  payments: PaymentsPort | undefined,
  now: Date,
): Promise<{ status: SubscriptionStatus }> {
  const sub = await billingTx(tx).subscription.findFirst({ where: { id: subscriptionId } });
  if (!sub) throw notFound();
  if (sub.status !== 'past_due' && sub.status !== 'grace' && sub.status !== 'paused') {
    throw new DomainError('CONFLICT', 'Only a past-due subscription can be retried.');
  }
  return chargeSubscription(tx, orgId, sub, payments, now, {
    description: 'Subscription retry',
    idempotencyKey: `retry-${sub.id}-${sub.failedAttempts}`,
  });
}

/**
 * Worker sweep (K3, K7): charges one subscription whose next charge date has arrived (a renewal, the next plan
 * installment, or the first charge after a trial). Re-checks under the row lock; returns null when it was not due.
 * A failed charge takes the failed-payment path (retries, "Needs review", optional grace).
 */
export async function chargeDueRenewal(
  tx: TenantTx,
  orgId: string,
  subscriptionId: string,
  payments?: PaymentsPort,
  now: Date = new Date(),
): Promise<{ status: SubscriptionStatus } | null> {
  if (!isUuid(subscriptionId)) return null;
  const db = billingTx(tx);
  await db.subscription.updateMany({ where: { id: subscriptionId }, data: { updatedAt: now } });
  const sub = await db.subscription.findFirst({
    where: {
      id: subscriptionId,
      status: { in: ['active', 'trialing'] },
      nextChargeAt: { lte: now },
    },
  });
  if (!sub) return null;
  // A trial is created as `trialing` at checkout, before the buyer finishes it: only a confirmed one (it has its
  // zero-amount payment) is charged when the trial ends.
  if (sub.status === 'trialing') {
    const confirmed = await db.payment.findFirst({
      where: { subscriptionId: sub.id },
      select: { id: true },
    });
    if (!confirmed) return null;
  }
  return chargeSubscription(tx, orgId, sub, payments, now, {
    description: 'Subscription renewal',
    idempotencyKey: `renew-${sub.id}-${(sub.nextChargeAt as Date).toISOString()}`,
  });
}

/**
 * Charges a subscription through its provider. Success records the payment and a branded receipt (so revenue and the
 * client's receipts include it), clears any failure state and starts the next period; failure records it.
 */
async function chargeSubscription(
  tx: TenantTx,
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sub: any,
  payments: PaymentsPort | undefined,
  now: Date,
  opts: { description: string; idempotencyKey: string },
): Promise<{ status: SubscriptionStatus }> {
  const db = billingTx(tx);
  const provider = payments ?? defaultPaymentsProvider(sub.provider as ProviderKind);
  const charge = await provider.createCharge({
    providerAccountId: `org_${orgId}`,
    customerEmail: sub.customerEmail as string,
    amount: { amountMinor: sub.amountMinor as number, currency: sub.currency as string },
    description: opts.description,
    idempotencyKey: opts.idempotencyKey,
  });
  if (charge.status !== 'succeeded') {
    await recordPaymentFailure(
      tx,
      { subscriptionId: sub.id, reason: charge.failureReason ?? 'Payment failed.' },
      now,
    );
    return { status: 'past_due' };
  }
  const payment = await db.payment.create({
    data: {
      packageId: sub.packageId,
      clientId: sub.clientId,
      customerEmail: sub.customerEmail,
      provider: sub.provider,
      amountMinor: sub.amountMinor,
      taxMinor: sub.taxMinor ?? 0,
      taxRateBps: sub.taxRateBps ?? 0,
      currency: sub.currency,
      status: 'succeeded',
      kind: sub.installments !== null ? 'payment_plan' : 'recurring',
      subscriptionId: sub.id,
      providerChargeId: charge.providerChargeId,
      paidAt: now,
    },
    select: { id: true },
  });
  await db.receipt.create({
    data: {
      paymentId: payment.id,
      number: `R-${now.getUTCFullYear()}-${(payment.id as string).slice(0, 8).toUpperCase()}`,
      customerEmail: sub.customerEmail,
      description: 'Coaching package',
      amountMinor: sub.amountMinor,
      taxMinor: sub.taxMinor ?? 0,
      taxRateBps: sub.taxRateBps ?? 0,
      currency: sub.currency,
      issuedAt: now,
    },
  });
  await db.subscription.updateMany({
    where: { id: sub.id },
    data: {
      status: 'active',
      failedAttempts: 0,
      nextRetryAt: null,
      graceEndsAt: null,
      needsReview: false,
      ...periodAfterCharge(sub, now),
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
  // Row lock first (no-op UPDATE): two refunds of one payment run one after the other, so together they never
  // exceed it.
  await db.payment.updateMany({
    where: { id: input.paymentId },
    data: { refundedMinor: { increment: 0 } },
  });
  const payment = await db.payment.findFirst({ where: { id: input.paymentId } });
  if (!payment) throw notFound();
  // A partly refunded payment can be refunded again, up to what is left.
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw new DomainError('CONFLICT', 'Only a paid payment can be refunded.');
  }
  const already = (payment.refundedMinor as number) ?? 0;
  if (already + amount > (payment.amountMinor as number)) {
    throw new DomainError('CONFLICT', 'That refund is more than the payment.');
  }
  // Manual payments refund without a provider; a provider charge needs online payments.
  const result = payment.providerChargeId
    ? await (payments ?? defaultPaymentsProvider(payment.provider as ProviderKind)).refundCharge(
        payment.providerChargeId as string,
        amount,
      )
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
  // No billing portal link while online payments are off.
  const provider = payments ?? (onlinePaymentsAvailable() ? fakePaymentsProvider('stripe') : null);
  const portal =
    sub && provider
      ? await provider.createPortalSession({
          providerCustomerId: `cus_fake_${clientId ?? 'anon'}`,
          returnUrl: '/portal/billing',
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
  if (paidAt.getTime() > now.getTime() + 60_000)
    throw invalid('paidAt', 'Pick today or an earlier date.');
  const currency =
    input.currency === undefined || input.currency === null || input.currency === ''
      ? (pkg.currency as string)
      : typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency.toUpperCase())
        ? input.currency.toUpperCase()
        : (() => {
            throw invalid('currency', 'Use a 3-letter currency code.');
          })();
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
      currency,
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
      currency,
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
  // A client sees only receipts for their own payments; a payment with no client record is never theirs.
  const mine = actor.role === 'client' ? await ownClientId(tx, actor) : null;
  if (actor.role === 'client' && (!mine || row.payment?.clientId !== mine)) {
    throw notFound();
  }
  const org = await tx.organization.findFirstOrThrow({
    select: { name: true, brandAccent: true, logoUrl: true },
  });
  return receiptView(row, org);
}
