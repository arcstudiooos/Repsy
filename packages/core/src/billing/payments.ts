import { DomainError } from '../errors';

/**
 * PRD K1, K2, K6: one payments port for both providers. Stripe Connect (coaches
 * connect a Stripe Standard account; payouts and disputes stay in their Stripe)
 * and Razorpay (India: UPI, cards, subscriptions) sit behind this interface, so
 * packages, checkout and billing never know which provider is in use.
 *
 * FAKE PROVIDER ONLY. The only implementation in this slice is
 * `FakePaymentsProvider`: it mints deterministic test ids and test URLs, keeps
 * charges in memory, and never imports a Stripe or Razorpay SDK, never reads a
 * key, and never makes a network call. A real provider adapter is a future
 * change that implements this same interface; nothing else in billing changes.
 * Money is always integer minor units (cents / paise) with a currency code.
 * The platform fee is 0% in year one (PRD §payments): only processor fees,
 * which the fake provider reports as 0 because it charges nothing.
 */

export const PROVIDER_KINDS = ['stripe', 'razorpay'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Money in minor units: 1000 = $10.00 / ₹10.00. Never a float. */
export interface Money {
  amountMinor: number;
  currency: string;
}

export interface TaxQuote {
  /** Minor units of tax on top of (or inside) the subtotal. */
  taxMinor: number;
  /** Minor units the buyer pays in total. */
  totalMinor: number;
  /** Basis points actually applied, e.g. 1800 = 18% GST. */
  rateBps: number;
  /** True when the quoted amount already included tax. */
  taxInclusive: boolean;
  label: string;
}

/**
 * Pure tax math (K6). Stripe Tax / GST are port fields, not SDK calls: the
 * caller passes the rate it wants, and the fake provider fills in the India
 * default (18% GST) for INR when no rate is given. Nothing here calls a tax
 * service, so a real adapter can replace the default with a live quote.
 */
export function calculateTax(
  amountMinor: number,
  input: { currency: string; taxRateBps?: number; taxInclusive?: boolean },
): TaxQuote {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      amountMinor: ['Use a whole number of cents or paise, 0 or more.'],
    });
  }
  const currency = input.currency.toUpperCase();
  const rateBps = input.taxRateBps ?? (currency === 'INR' ? 1800 : 0);
  const taxInclusive = input.taxInclusive ?? false;
  if (taxInclusive) {
    const subtotal = Math.round((amountMinor * 10_000) / (10_000 + rateBps));
    return {
      taxMinor: amountMinor - subtotal,
      totalMinor: amountMinor,
      rateBps,
      taxInclusive: true,
      label: currency === 'INR' ? 'GST included' : 'Tax included',
    };
  }
  const taxMinor = Math.round((amountMinor * rateBps) / 10_000);
  return {
    taxMinor,
    totalMinor: amountMinor + taxMinor,
    rateBps,
    taxInclusive: false,
    label: currency === 'INR' ? 'GST' : 'Tax',
  };
}

/** Sensible default provider per currency; the coach's connected account wins. */
export function defaultProviderForCurrency(currency: string): ProviderKind {
  return currency.toUpperCase() === 'INR' ? 'razorpay' : 'stripe';
}

/** Zero-decimal currencies (no cents/paise): amounts are already whole units. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'XAF', 'XOF', 'XPF']);

/** Pure display helper: minor units to a readable amount, e.g. 9900 USD -> "99.00 USD". */
export function formatMoneyMinor(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  const major = ZERO_DECIMAL.has(code) ? amountMinor : amountMinor / 100;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).format(major);
  } catch {
    return `${major.toFixed(ZERO_DECIMAL.has(code) ? 0 : 2)} ${code}`;
  }
}

export interface ConnectAccountInput {
  /** The coach's workspace id, used only to scope the fake account id. */
  orgId: string;
  /** Display name shown on the fake connect screen. */
  displayName: string;
}

export interface ConnectAccountResult {
  provider: ProviderKind;
  /** Fake account id, e.g. `acct_fake_stripe_…`. Never a real account id. */
  providerAccountId: string;
  /** Fake onboarding URL. Visiting it does nothing real. */
  onboardingUrl: string;
}

export interface CheckoutSessionInput {
  providerAccountId: string;
  customerEmail: string;
  /** What the buyer pays for, shown on the fake checkout page. */
  description: string;
  amount: Money;
  /** Recurring checkout becomes a provider subscription; otherwise one charge. */
  recurring?: { interval: 'week' | 'month' };
  /** Provider-side metadata; never carries client health or program data. */
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  /** Fake hosted checkout URL. Clearly a test URL; no real payment form. */
  url: string;
  provider: ProviderKind;
}

export interface ChargeInput {
  providerAccountId: string;
  customerEmail: string;
  amount: Money;
  description: string;
  /** Idempotency key: the same key charged twice charges once. */
  idempotencyKey: string;
}

export interface ChargeResult {
  providerChargeId: string;
  status: 'succeeded' | 'failed';
  failureReason: string | null;
  /** Processor fee in minor units; 0 from the fake provider. */
  processorFeeMinor: number;
}

export interface RefundResult {
  providerRefundId: string;
  refundedMinor: number;
}

export interface PaymentsPort {
  readonly kind: ProviderKind;
  connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  refundCharge(providerChargeId: string, amountMinor: number): Promise<RefundResult>;
  /** Link where the buyer updates their card. Fake: a test portal URL. */
  createPortalSession(input: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  calculateTax(
    amountMinor: number,
    input: { currency: string; taxRateBps?: number; taxInclusive?: boolean },
  ): TaxQuote;
}

/**
 * The fake provider (K1, K2). Deterministic ids, in-memory charges, no I/O.
 * `failNextCharge` exists so failed-payment handling (K7) can be exercised in
 * tests and demos without a real declined card.
 */
export class FakePaymentsProvider implements PaymentsPort {
  readonly kind: ProviderKind;
  private counter = 0;
  private charges = new Map<
    string,
    { amountMinor: number; currency: string; refundedMinor: number }
  >();
  private chargesByKey = new Map<string, ChargeResult>();
  /** When set, the next charge fails with this reason, then clears. */
  failNextChargeWith: string | null = null;

  constructor(kind: ProviderKind) {
    if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        provider: ['Pick stripe or razorpay.'],
      });
    }
    this.kind = kind;
  }

  private next(prefix: string): string {
    this.counter += 1;
    return `${prefix}_fake_${this.kind}_${String(this.counter).padStart(6, '0')}`;
  }

  async connectAccount(input: ConnectAccountInput): Promise<ConnectAccountResult> {
    const providerAccountId = this.next('acct');
    return {
      provider: this.kind,
      providerAccountId,
      onboardingUrl: `https://connect.test/${this.kind}/onboarding/${providerAccountId}?org=${encodeURIComponent(input.orgId)}`,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const id = this.next('cs');
    const params = new URLSearchParams({
      amount: String(input.amount.amountMinor),
      currency: input.amount.currency,
      email: input.customerEmail,
      desc: input.description,
    });
    if (input.recurring) params.set('interval', input.recurring.interval);
    return { id, url: `https://checkout.test/${this.kind}/${id}?${params}`, provider: this.kind };
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const existing = this.chargesByKey.get(input.idempotencyKey);
    if (existing) return existing;
    if (this.failNextChargeWith) {
      const reason = this.failNextChargeWith;
      this.failNextChargeWith = null;
      const failed: ChargeResult = {
        providerChargeId: this.next('ch'),
        status: 'failed',
        failureReason: reason,
        processorFeeMinor: 0,
      };
      this.chargesByKey.set(input.idempotencyKey, failed);
      return failed;
    }
    const result: ChargeResult = {
      providerChargeId: this.next('ch'),
      status: 'succeeded',
      failureReason: null,
      processorFeeMinor: 0,
    };
    this.charges.set(result.providerChargeId, {
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      refundedMinor: 0,
    });
    this.chargesByKey.set(input.idempotencyKey, result);
    return result;
  }

  async refundCharge(providerChargeId: string, amountMinor: number): Promise<RefundResult> {
    const charge = this.charges.get(providerChargeId);
    if (!charge) {
      throw new DomainError('NOT_FOUND', 'That charge does not exist in the test provider.');
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        amountMinor: ['Refund a whole number of cents or paise above 0.'],
      });
    }
    if (charge.refundedMinor + amountMinor > charge.amountMinor) {
      throw new DomainError('CONFLICT', 'That refund is more than the charge.');
    }
    charge.refundedMinor += amountMinor;
    return { providerRefundId: this.next('re'), refundedMinor: amountMinor };
  }

  async createPortalSession(input: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const params = new URLSearchParams({
      customer: input.providerCustomerId,
      return: input.returnUrl,
    });
    return { url: `https://portal.test/${this.kind}/session?${params}` };
  }

  calculateTax(
    amountMinor: number,
    input: { currency: string; taxRateBps?: number; taxInclusive?: boolean },
  ): TaxQuote {
    return calculateTax(amountMinor, input);
  }
}

/** One fake provider per kind; a real adapter plugs in here later. */
export function fakePaymentsProvider(kind: ProviderKind): PaymentsPort {
  return new FakePaymentsProvider(kind);
}

/**
 * Online payments (checkout, renewals, retries, provider refunds) run on the fake provider only, so they are off in
 * production until a real Stripe/Razorpay adapter exists (go-live review 2026-11-08). Outside production, or with
 * PAYMENTS_FAKE=true (E2E, demos), the fake provider stays available. Manual payments are never affected.
 */
export function onlinePaymentsAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.PAYMENTS_FAKE === 'true';
}

export const PAYMENTS_UNAVAILABLE_MESSAGE =
  'Online payments are not available yet. Record payments you take elsewhere against the client instead.';

export function assertOnlinePayments(): void {
  if (!onlinePaymentsAvailable()) {
    throw new DomainError('PAYMENTS_UNAVAILABLE', PAYMENTS_UNAVAILABLE_MESSAGE);
  }
}

/** The provider used when a caller does not pass one: the fake, and only where online payments are available. */
export function defaultPaymentsProvider(kind: ProviderKind): PaymentsPort {
  assertOnlinePayments();
  return fakePaymentsProvider(kind);
}
