/**
 * PRD K1, K2 (D-013 #1, #3): what Repsy needs from a payment provider. Adapters (Stripe Connect, Razorpay, and a
 * deterministic fake for development and tests) live outside `packages/core` except the fake; core never imports a
 * provider SDK. Every amount is in the currency's minor unit.
 */
export type ProviderName = 'stripe' | 'razorpay' | 'fake';

/** A connected account: its provider id, and its sealed tokens when the provider needs them. */
export interface ConnectedAccount {
  provider: ProviderName;
  accountRef: string;
  /** Decrypted OAuth access token (Razorpay); never logged. */
  accessToken?: string;
}

export interface CheckoutRequest {
  account: ConnectedAccount;
  /** Repsy's purchase id, echoed back by the provider (metadata or notes). */
  purchaseId: string;
  currency: string;
  title: string;
  buyerEmail: string;
  mode: 'payment' | 'subscription';
  /** The first charge after any coupon (0 only with a trial). */
  firstChargeMinor: number;
  /** Each later charge; equals the price for subscriptions and plans. */
  recurringMinor: number;
  interval?: { unit: 'week' | 'month'; count: number };
  /** Payment plan: the total number of charges, after which the subscription ends. */
  installments?: number;
  trialDays: number;
  /** Ask the provider to compute tax (Stripe Tax, D-013 #6). */
  automaticTax: boolean;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** Where to send the buyer: the provider's hosted checkout. */
  url: string;
  /** The provider's checkout id, unique per provider. */
  checkoutRef: string;
}

export type PaymentMethod = 'card' | 'upi' | 'bank' | 'other';

/** Provider events, normalized. `eventId` is the provider's own and is stored once (D-013 #3). */
export type PaymentEvent =
  | {
      type: 'checkout_completed';
      eventId: string;
      checkoutRef: string;
      purchaseId: string | null;
      customerRef: string | null;
      subscriptionRef: string | null;
    }
  | {
      type: 'payment_succeeded';
      eventId: string;
      paymentRef: string;
      checkoutRef: string | null;
      subscriptionRef: string | null;
      amountMinor: number;
      taxMinor: number;
      currency: string;
      method: PaymentMethod;
      paidAt: Date;
      /** The end of the period this charge pays for (subscriptions and plans). */
      periodEnd: Date | null;
    }
  | {
      type: 'payment_failed';
      eventId: string;
      paymentRef: string | null;
      checkoutRef: string | null;
      subscriptionRef: string | null;
      amountMinor: number;
      currency: string;
      /** A decline code only, never the provider's message. */
      failureCode: string | null;
      at: Date;
    }
  | {
      type: 'subscription_updated';
      eventId: string;
      subscriptionRef: string;
      status: 'trialing' | 'active' | 'past_due' | 'canceled';
      periodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | { type: 'subscription_ended'; eventId: string; subscriptionRef: string; at: Date }
  | { type: 'refunded'; eventId: string; paymentRef: string; refundedMinor: number };

export interface WebhookBatch {
  /** The connected account the event belongs to; resolves the workspace (app_org_by_payment_account). */
  accountRef: string;
  events: PaymentEvent[];
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature.') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface PaymentsPort {
  readonly provider: ProviderName;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Cancels now, or at the end of the paid period. */
  cancelSubscription(
    account: ConnectedAccount,
    subscriptionRef: string,
    atPeriodEnd: boolean,
  ): Promise<void>;
  /** Refunds all or part of a payment; the provider confirms it with a `refunded` event. */
  refund(account: ConnectedAccount, paymentRef: string, amountMinor: number): Promise<void>;
  /** The provider's hosted page where a buyer updates their card (K8), or null when the provider has none. */
  manageUrl(
    account: ConnectedAccount,
    refs: { customerRef: string | null; subscriptionRef: string | null; returnUrl: string },
  ): Promise<string | null>;
  /** Verifies and normalizes a webhook. Throws WebhookSignatureError when it isn't the provider's. */
  parseWebhook(rawBody: string, headers: Headers, now: Date): WebhookBatch;
}
