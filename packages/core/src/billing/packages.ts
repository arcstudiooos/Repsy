import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import {
  defaultProviderForCurrency,
  fakePaymentsProvider,
  type PaymentsPort,
  type ProviderKind,
} from './payments';

/**
 * PRD K3, K4, K5: packages, the storefront, checkout and coupons.
 *
 * A package is what a coach sells: a one-off payment, a recurring weekly or
 * monthly subscription, a payment plan (e.g. 3 x $100), or any of those with a
 * free trial. Buying one can invite the buyer, tag them, start an onboarding
 * sequence (J4) and assign a template — but this slice only STORES those
 * instructions (`onboardingSequence`, `renewalReminderDays`, `inviteOnPurchase`,
 * `tagsOnPurchase`, `templateId`). The sequence/journey execution itself is the
 * scheduling slice's work and must read these fields, not re-derive them.
 *
 * DB functions below use `tx.billingPackage`, `tx.coupon`, `tx.subscription`,
 * `tx.payment` and `tx.receipt`. Those models do not exist in `schema.prisma`
 * yet: apply `SCHEMA_SNIPPET_BILLING.md` at the repo root first, then replace
 * the `BillingTx` cast with the generated Prisma delegates. The pure functions
 * (price math, plan schedule, trial dates) need no database at all and are the
 * ones covered by `billing.test.ts`.
 */

export const PACKAGE_KINDS = ['one_off', 'recurring', 'payment_plan'] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const BILLING_INTERVALS = ['week', 'month'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const CURRENCIES = /^[A-Z]{3}$/;

export interface PackageView {
  id: string;
  title: string;
  description: string;
  kind: PackageKind;
  interval: BillingInterval | null;
  /** Minor units per charge (per installment for a payment plan). */
  amountMinor: number;
  currency: string;
  installments: number | null;
  trialDays: number;
  active: boolean;
  /** Stored only; executed by the journeys slice (J4/J6). */
  onboardingSequence: unknown;
  renewalReminderDays: number;
  inviteOnPurchase: boolean;
  tagsOnPurchase: string[];
  templateId: string | null;
}

export interface PackageInput {
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  interval?: unknown;
  amountMinor?: unknown;
  currency?: unknown;
  installments?: unknown;
  trialDays?: unknown;
  active?: unknown;
  onboardingSequence?: unknown;
  renewalReminderDays?: unknown;
  inviteOnPurchase?: unknown;
  tagsOnPurchase?: unknown;
  templateId?: unknown;
}

export interface CouponView {
  id: string;
  code: string;
  kind: 'percentage' | 'fixed';
  /** Percent (1-100) or fixed minor units, depending on kind. */
  value: number;
  currency: string | null;
  expiresAt: string | null;
  usageCap: number | null;
  usedCount: number;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

function cleanText(v: unknown, field: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && s.length < 1) throw invalid(field, 'Enter a value.');
  if (s.length > max) throw invalid(field, `Use at most ${max} characters.`);
  return s;
}

function cleanInt(v: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw invalid(field, 'Enter a whole number.');
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw invalid(field, `Use a whole number from ${min} to ${max}.`);
  }
  return n;
}

/** Pure: split a total into N installments; the remainder goes on the last one. */
export function paymentPlanSchedule(totalMinor: number, installments: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) {
    throw invalid('amountMinor', 'Use a whole number of cents or paise, 0 or more.');
  }
  if (!Number.isInteger(installments) || installments < 2 || installments > 24) {
    throw invalid('installments', 'A payment plan has 2 to 24 installments.');
  }
  const base = Math.floor(totalMinor / installments);
  const out = Array.from({ length: installments }, () => base);
  out[installments - 1] = totalMinor - base * (installments - 1);
  return out;
}

/** Pure: the day a free trial ends (the first chargeable day). */
export function trialEndDate(start: Date, trialDays: number): Date {
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) {
    throw invalid('trialDays', 'A trial is 0 to 365 days.');
  }
  return new Date(start.getTime() + trialDays * 86_400_000);
}

/** Pure: the next charge date for a recurring package. Months clamp to month-end. */
export function nextChargeDate(from: Date, interval: BillingInterval): Date {
  const d = new Date(from.getTime());
  if (interval === 'week') {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Pure: discount for one coupon against one amount. Never below zero. */
export function applyCoupon(
  amountMinor: number,
  coupon: { kind: 'percentage' | 'fixed'; value: number },
): { discountMinor: number; totalMinor: number } {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw invalid('amountMinor', 'Use a whole number of cents or paise, 0 or more.');
  }
  const discount =
    coupon.kind === 'percentage' ? Math.round((amountMinor * coupon.value) / 100) : coupon.value;
  const discountMinor = Math.max(0, Math.min(amountMinor, discount));
  return { discountMinor, totalMinor: amountMinor - discountMinor };
}

/** Pure: why a coupon cannot be used right now, or null when it can. */
export function couponProblem(
  coupon: {
    expiresAt: Date | null;
    usageCap: number | null;
    usedCount: number;
    currency: string | null;
  },
  currency: string,
  now: Date = new Date(),
): string | null {
  if (coupon.expiresAt && coupon.expiresAt <= now) return 'This coupon has expired.';
  if (coupon.usageCap !== null && coupon.usedCount >= coupon.usageCap) {
    return 'This coupon has been used up.';
  }
  if (coupon.currency && coupon.currency !== currency.toUpperCase()) {
    return 'This coupon is for a different currency.';
  }
  return null;
}

export function normalizeCouponCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

function packageView(row: {
  id: string;
  title: string;
  description: string;
  kind: string;
  interval: string | null;
  amountMinor: number;
  currency: string;
  installments: number | null;
  trialDays: number;
  active: boolean;
  onboardingSequence: unknown;
  renewalReminderDays: number;
  inviteOnPurchase: boolean;
  tagsOnPurchase: string[];
  templateId: string | null;
}): PackageView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind as PackageKind,
    interval: row.interval as BillingInterval | null,
    amountMinor: row.amountMinor,
    currency: row.currency,
    installments: row.installments,
    trialDays: row.trialDays,
    active: row.active,
    onboardingSequence: row.onboardingSequence,
    renewalReminderDays: row.renewalReminderDays,
    inviteOnPurchase: row.inviteOnPurchase,
    tagsOnPurchase: row.tagsOnPurchase,
    templateId: row.templateId,
  };
}

function validatePackageInput(input: PackageInput): Record<string, unknown> {
  const title = cleanText(input.title, 'title', 120, true);
  const description = cleanText(input.description, 'description', 2000);
  if (!(PACKAGE_KINDS as readonly unknown[]).includes(input.kind)) {
    throw invalid('kind', 'Pick one-off, recurring or payment plan.');
  }
  const kind = input.kind as PackageKind;
  const amountMinor = cleanInt(input.amountMinor, 'amountMinor', 0, 100_000_000);
  const currency =
    typeof input.currency === 'string' && CURRENCIES.test(input.currency.toUpperCase())
      ? input.currency.toUpperCase()
      : (() => {
          throw invalid('currency', 'Use a 3-letter currency code.');
        })();
  let interval: BillingInterval | null = null;
  let installments: number | null = null;
  if (kind === 'recurring') {
    if (!(BILLING_INTERVALS as readonly unknown[]).includes(input.interval)) {
      throw invalid('interval', 'Pick weekly or monthly.');
    }
    interval = input.interval as BillingInterval;
  } else if (kind === 'payment_plan') {
    installments = cleanInt(input.installments, 'installments', 2, 24);
    // A plan's amount is per installment; the total is amount x installments.
  }
  const trialDays = cleanInt(input.trialDays, 'trialDays', 0, 365, 0);
  if (kind === 'one_off' && trialDays > 0) {
    throw invalid('trialDays', 'A one-off package has no trial.');
  }
  const tags = Array.isArray(input.tagsOnPurchase)
    ? input.tagsOnPurchase
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const templateId =
    typeof input.templateId === 'string' && input.templateId !== '' ? input.templateId : null;
  if (templateId && !isUuid(templateId)) throw invalid('templateId', 'Pick a template.');
  return {
    title,
    description,
    kind,
    interval,
    amountMinor,
    currency,
    installments,
    trialDays,
    active: input.active !== false,
    onboardingSequence: (() => {
      // J4: stored as JSON so journeys can read { sequenceId } or { steps: [...] }.
      // Accept an object directly, or a JSON string of one; anything else is invalid.
      if (
        input.onboardingSequence === null ||
        input.onboardingSequence === undefined ||
        input.onboardingSequence === ''
      )
        return null;
      let parsed: unknown = input.onboardingSequence;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          throw invalid('onboardingSequence', 'Use a sequenceId or a steps list.');
        }
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw invalid('onboardingSequence', 'Use a sequenceId or a steps list.');
      return parsed;
    })(),
    renewalReminderDays: cleanInt(input.renewalReminderDays, 'renewalReminderDays', 0, 30, 3),
    inviteOnPurchase: input.inviteOnPurchase === true,
    tagsOnPurchase: tags,
    templateId,
  };
}

// ---------------------------------------------------------------------------
// Database functions. `BillingTx` is the shape the schema snippet adds to the
// Prisma client; until it is applied, these cast from TenantTx (see the file
// header). Nothing here imports a payments SDK.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = any;
export type BillingTx = TenantTx & {
  billingPackage: AnyDelegate;
  coupon: AnyDelegate;
  subscription: AnyDelegate;
  payment: AnyDelegate;
  receipt: AnyDelegate;
};

const billingTx = (tx: TenantTx): BillingTx => tx as unknown as BillingTx;

/** Coach creates or edits a package (K3). */
export async function savePackage(
  tx: TenantTx,
  actor: ActorContext,
  input: PackageInput & { id?: unknown },
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const data = validatePackageInput(input);
  const db = billingTx(tx);
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await db.billingPackage.updateMany({
      where: { id: input.id },
      data,
    });
    if (count === 0) throw notFound();
    return { id: input.id as string };
  }
  const row = await db.billingPackage.create({ data, select: { id: true } });
  void opts;
  return { id: row.id as string };
}

/** Coach archives a package; existing subscriptions keep running (K3). */
export async function archivePackage(tx: TenantTx, actor: ActorContext, id: string): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const { count } = await billingTx(tx).billingPackage.updateMany({
    where: { id },
    data: { active: false },
  });
  if (count === 0) throw notFound();
}

/** Coach lists every package, active or archived. */
export async function listPackages(tx: TenantTx, actor: ActorContext): Promise<PackageView[]> {
  assertCan(actor, 'client:update');
  const rows = await billingTx(tx).billingPackage.findMany({
    orderBy: [{ active: 'desc' }, { title: 'asc' }],
  });
  return rows.map(packageView);
}

/** Public storefront (K4): only active packages, in tenant scope resolved by slug. */
export async function listStorefrontPackages(tx: TenantTx): Promise<PackageView[]> {
  const rows = await billingTx(tx).billingPackage.findMany({
    where: { active: true },
    orderBy: [{ title: 'asc' }],
  });
  return rows.map(packageView);
}

/** Coach creates or edits a coupon (K5). Percentage 1-100, or a fixed amount. */
export async function saveCoupon(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    id?: unknown;
    code?: unknown;
    kind?: unknown;
    value?: unknown;
    currency?: unknown;
    expiresAt?: unknown;
    usageCap?: unknown;
  },
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const code = normalizeCouponCode(typeof input.code === 'string' ? input.code : '');
  if (code.length < 3 || code.length > 24) throw invalid('code', 'Use 3-24 letters or numbers.');
  if (input.kind !== 'percentage' && input.kind !== 'fixed') {
    throw invalid('kind', 'Pick percentage or fixed.');
  }
  const value =
    input.kind === 'percentage'
      ? cleanInt(input.value, 'value', 1, 100)
      : cleanInt(input.value, 'value', 1, 100_000_000);
  const currency =
    input.kind === 'fixed'
      ? typeof input.currency === 'string' && CURRENCIES.test(input.currency.toUpperCase())
        ? input.currency.toUpperCase()
        : (() => {
            throw invalid('currency', 'A fixed coupon needs a 3-letter currency code.');
          })()
      : null;
  let expiresAt: Date | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    const d = new Date(input.expiresAt as string);
    if (Number.isNaN(d.getTime())) throw invalid('expiresAt', 'Pick a date.');
    expiresAt = d;
  }
  const usageCap =
    input.usageCap === undefined || input.usageCap === null || input.usageCap === ''
      ? null
      : cleanInt(input.usageCap, 'usageCap', 1, 1_000_000);
  const data = { code, kind: input.kind, value, currency, expiresAt, usageCap };
  const db = billingTx(tx);
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await db.coupon
      .updateMany({ where: { id: input.id }, data })
      .catch((error: unknown) => {
        if ((error as { code?: unknown } | null)?.code === 'P2002') {
          throw invalid('code', 'A coupon with this code already exists.');
        }
        throw error;
      });
    if (count === 0) throw notFound();
    return { id: input.id as string };
  }
  const row = await db.coupon.create({ data, select: { id: true } }).catch((error: unknown) => {
    if ((error as { code?: unknown } | null)?.code === 'P2002') {
      throw invalid('code', 'A coupon with this code already exists.');
    }
    throw error;
  });
  return { id: row.id as string };
}

/** Validates a coupon code against an amount; does not consume it (K5). */
export async function validateCoupon(
  tx: TenantTx,
  code: string,
  amountMinor: number,
  currency: string,
  now: Date = new Date(),
): Promise<{ coupon: CouponView; discountMinor: number; totalMinor: number }> {
  const normalized = normalizeCouponCode(code);
  const row = await billingTx(tx).coupon.findFirst({ where: { code: normalized } });
  if (!row) throw new DomainError('NOT_FOUND', 'That coupon does not exist.');
  const problem = couponProblem(
    {
      expiresAt: row.expiresAt as Date | null,
      usageCap: row.usageCap as number | null,
      usedCount: row.usedCount as number,
      currency: row.currency as string | null,
    },
    currency,
    now,
  );
  if (problem) throw new DomainError('CONFLICT', problem);
  const { discountMinor, totalMinor } = applyCoupon(amountMinor, {
    kind: row.kind as 'percentage' | 'fixed',
    value: row.value as number,
  });
  return {
    coupon: {
      id: row.id as string,
      code: row.code as string,
      kind: row.kind as 'percentage' | 'fixed',
      value: row.value as number,
      currency: row.currency as string | null,
      expiresAt: (row.expiresAt as Date | null)?.toISOString() ?? null,
      usageCap: row.usageCap as number | null,
      usedCount: row.usedCount as number,
    },
    discountMinor,
    totalMinor,
  };
}

export interface CheckoutResult {
  /** Fake hosted checkout URL. No real payment form is ever shown. */
  checkoutUrl: string;
  checkoutSessionId: string;
  subscriptionId: string | null;
  paymentId: string | null;
  /** What the buyer pays now, after coupon and tax, in minor units. */
  amountDueMinor: number;
  currency: string;
  provider: ProviderKind;
}

/**
 * Starts a purchase (K4). Creates a pending subscription (recurring / plan) or
 * payment (one-off) and a fake hosted checkout session for it. The buyer is
 * not charged here: the fake provider charges nothing, and a real adapter would
 * charge only after the buyer completes hosted checkout. `confirmCheckout`
 * (billing.ts) is the demo stand-in for that completion; a real adapter would
 * call it from a verified webhook, never from a client request.
 */
export async function createCheckout(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    packageId?: unknown;
    clientId?: unknown;
    customerEmail?: unknown;
    couponCode?: unknown;
    provider?: unknown;
  },
  payments?: PaymentsPort,
  now: Date = new Date(),
): Promise<CheckoutResult> {
  assertCan(actor, 'client:update');
  if (!isUuid(input.packageId)) throw notFound();
  const db = billingTx(tx);
  const pkg = await db.billingPackage.findFirst({
    where: { id: input.packageId, active: true },
  });
  if (!pkg) throw notFound();
  const clientId =
    typeof input.clientId === 'string' && isUuid(input.clientId) ? input.clientId : null;
  const email = typeof input.customerEmail === 'string' ? input.customerEmail.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalid('customerEmail', 'Enter an email address.');
  }
  let coupon: { id: string } | null = null;
  let amountMinor = pkg.amountMinor as number;
  if (typeof input.couponCode === 'string' && input.couponCode.trim() !== '') {
    const checked = await validateCoupon(tx, input.couponCode, amountMinor, pkg.currency, now);
    if (checked.coupon.usageCap !== null) {
      // A use is consumed only when a purchase is confirmed, so checkouts still open hold one each. Under the
      // coupon's row lock (no-op UPDATE), so two buyers cannot both take the last use.
      await db.coupon.updateMany({
        where: { id: checked.coupon.id },
        data: { usedCount: { increment: 0 } },
      });
      const held =
        (await db.payment.count({ where: { couponId: checked.coupon.id, status: 'pending' } })) +
        (await db.subscription.count({
          where: { couponId: checked.coupon.id, status: 'pending' },
        }));
      const fresh = await db.coupon.findFirst({
        where: { id: checked.coupon.id },
        select: { usedCount: true },
      });
      if ((fresh?.usedCount ?? 0) + held >= checked.coupon.usageCap) {
        throw new DomainError('CONFLICT', 'This coupon has been used up.');
      }
    }
    coupon = { id: checked.coupon.id };
    amountMinor = checked.totalMinor;
    // Consume one use only when the purchase completes (see confirmCheckout).
  }
  const kind = pkg.kind as PackageKind;
  const providerKind: ProviderKind =
    input.provider === 'stripe' || input.provider === 'razorpay'
      ? (input.provider as ProviderKind)
      : defaultProviderForCurrency(pkg.currency as string);
  const provider = payments ?? fakePaymentsProvider(providerKind);
  const tax = provider.calculateTax(amountMinor, { currency: pkg.currency as string });
  const trialDays = pkg.trialDays as number;
  const firstCharge = trialDays > 0 ? trialEndDate(now, trialDays) : now;
  let subscriptionId: string | null = null;
  let paymentId: string | null = null;
  if (kind === 'one_off') {
    const payment = await db.payment.create({
      data: {
        packageId: pkg.id,
        clientId,
        customerEmail: email,
        provider: providerKind,
        amountMinor: tax.totalMinor,
        taxMinor: tax.taxMinor,
        taxRateBps: tax.rateBps,
        currency: pkg.currency,
        status: 'pending',
        kind: 'one_off',
        couponId: coupon?.id ?? null,
      },
      select: { id: true },
    });
    paymentId = payment.id as string;
  } else {
    const installments = kind === 'payment_plan' ? (pkg.installments as number) : null;
    const periodEnd =
      kind === 'recurring'
        ? nextChargeDate(firstCharge, pkg.interval as 'week' | 'month')
        : firstCharge;
    const sub = await db.subscription.create({
      data: {
        packageId: pkg.id,
        clientId,
        customerEmail: email,
        provider: providerKind,
        status: trialDays > 0 ? 'trialing' : 'pending',
        amountMinor: tax.totalMinor,
        // Stored so every receipt for this subscription shows the tax it includes (K6).
        taxMinor: tax.taxMinor,
        taxRateBps: tax.rateBps,
        currency: pkg.currency,
        interval: pkg.interval ?? null,
        installments,
        installmentsPaid: 0,
        trialEndsAt: trialDays > 0 ? trialEndDate(now, trialDays) : null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextChargeAt: firstCharge,
        couponId: coupon?.id ?? null,
      },
      select: { id: true },
    });
    subscriptionId = sub.id as string;
  }
  const session = await provider.createCheckoutSession({
    providerAccountId: `org_${actor.orgId}`,
    customerEmail: email,
    description: pkg.title as string,
    amount: { amountMinor: tax.totalMinor, currency: pkg.currency as string },
    recurring: kind === 'recurring' ? { interval: pkg.interval as 'week' | 'month' } : undefined,
    metadata: {
      packageId: pkg.id as string,
      subscriptionId: subscriptionId ?? '',
      paymentId: paymentId ?? '',
    },
  });
  return {
    checkoutUrl: session.url,
    checkoutSessionId: session.id,
    subscriptionId,
    paymentId,
    amountDueMinor: tax.totalMinor,
    currency: pkg.currency as string,
    provider: providerKind,
  };
}

/** What buying this package sets up, for the journeys slice to execute (J4/J6). */
export function purchaseSetup(pkg: PackageView): {
  onboardingSequence: unknown;
  renewalReminderDays: number;
  inviteOnPurchase: boolean;
  tagsOnPurchase: string[];
  templateId: string | null;
} {
  return {
    onboardingSequence: pkg.onboardingSequence,
    renewalReminderDays: pkg.renewalReminderDays,
    inviteOnPurchase: pkg.inviteOnPurchase,
    tagsOnPurchase: pkg.tagsOnPurchase,
    templateId: pkg.templateId,
  };
}
