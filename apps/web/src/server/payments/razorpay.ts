import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutResult,
  type ConnectedAccount,
  type PaymentEvent,
  type PaymentMethod,
  type PaymentsPort,
  type WebhookBatch,
} from '@kinetic/core';

/**
 * PRD K2 (D-013 #1, #3): Razorpay for India (UPI, cards, subscriptions) through Razorpay's partner OAuth, so each
 * coach is paid into their own Razorpay account. One-off packages use Payment Links; recurring and plans use
 * Subscriptions (a plan's instalments are its `total_count`). REST over `fetch`; no SDK. Enabled when
 * RAZORPAY_CLIENT_ID, RAZORPAY_CLIENT_SECRET and RAZORPAY_WEBHOOK_SECRET are set.
 */
const API = 'https://api.razorpay.com/v1';
const AUTH = 'https://auth.razorpay.com';

export interface RazorpayConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

type Fetch = typeof fetch;

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Razorpay request failed (${status}${code ? `, ${code}` : ''})`);
    this.name = 'RazorpayError';
  }
}

/** Razorpay subscriptions can't discount just the first charge, so a coupon there is refused at checkout. */
export class RazorpayCouponUnsupported extends Error {}

const METHODS: Record<string, PaymentMethod> = { card: 'card', upi: 'upi', netbanking: 'bank' };

export class RazorpayPayments implements PaymentsPort {
  readonly provider = 'razorpay' as const;

  constructor(
    private readonly config: RazorpayConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call<T>(
    account: ConnectedAccount,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!account.accessToken) throw new RazorpayError(401, 'not_connected');
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string };
      throw new RazorpayError(res.status, err.code ?? null);
    }
    return json as T;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const notes = { purchase_id: req.purchaseId };
    if (req.mode === 'payment') {
      const link = await this.call<{ id: string; short_url: string }>(
        req.account,
        'POST',
        '/payment_links',
        {
          amount: req.firstChargeMinor,
          currency: req.currency,
          description: req.title.slice(0, 2048),
          reference_id: req.purchaseId,
          customer: { email: req.buyerEmail },
          notify: { email: true },
          callback_url: req.successUrl,
          callback_method: 'get',
          notes,
        },
      );
      return { url: link.short_url, checkoutRef: link.id };
    }
    if (req.firstChargeMinor !== req.recurringMinor) throw new RazorpayCouponUnsupported();
    if (!req.interval) throw new RazorpayError(400, 'interval_required');
    const plan = await this.call<{ id: string }>(req.account, 'POST', '/plans', {
      period: req.interval.unit === 'week' ? 'weekly' : 'monthly',
      interval: req.interval.count,
      item: { name: req.title.slice(0, 120), amount: req.recurringMinor, currency: req.currency },
      notes,
    });
    const startAt =
      req.trialDays > 0 ? Math.floor(Date.now() / 1000) + req.trialDays * 86_400 : undefined;
    const sub = await this.call<{ id: string; short_url: string }>(
      req.account,
      'POST',
      '/subscriptions',
      {
        plan_id: plan.id,
        // A plan stops after its instalments; an open-ended subscription runs up to 10 years of charges.
        total_count: req.installments ?? (req.interval.unit === 'week' ? 520 : 120),
        quantity: 1,
        customer_notify: 1,
        notify_info: { notify_email: req.buyerEmail },
        ...(startAt ? { start_at: startAt } : {}),
        notes,
      },
    );
    return { url: sub.short_url, checkoutRef: sub.id };
  }

  async cancelSubscription(
    account: ConnectedAccount,
    subscriptionRef: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    await this.call(
      account,
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionRef)}/cancel`,
      {
        cancel_at_cycle_end: atPeriodEnd ? 1 : 0,
      },
    );
  }

  async refund(account: ConnectedAccount, paymentRef: string, amountMinor: number): Promise<void> {
    await this.call(account, 'POST', `/payments/${encodeURIComponent(paymentRef)}/refund`, {
      amount: amountMinor,
    });
  }

  /** Razorpay has no hosted card-update page for these; the client re-authorises from the subscription link. */
  manageUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  /** X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
  verify(rawBody: string, signature: string | null): void {
    const want = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest();
    const got = Buffer.from(signature ?? '', 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want))
      throw new WebhookSignatureError();
  }

  parseWebhook(rawBody: string, headers: Headers): WebhookBatch {
    this.verify(rawBody, headers.get('x-razorpay-signature'));
    const event = JSON.parse(rawBody) as {
      event: string;
      account_id?: string;
      created_at: number;
      payload: Record<string, { entity: Record<string, unknown> }>;
    };
    const eventId = headers.get('x-razorpay-event-id') ?? `${event.event}:${event.created_at}`;
    if (!event.account_id) return { accountRef: '', events: [] };
    return { accountRef: event.account_id, events: mapRazorpayEvent(eventId, event) };
  }

  connectUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: 'read_write',
      state,
    });
    return `${AUTH}/authorize?${q.toString()}`;
  }

  async completeConnect(
    code: string,
    redirectUri: string,
  ): Promise<{
    accountRef: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
  }> {
    const res = await this.fetchImpl(`${AUTH}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      razorpay_account_id?: string;
    };
    if (!res.ok || !json.access_token || !json.razorpay_account_id) {
      throw new RazorpayError(res.status, 'oauth_failed');
    }
    return {
      accountRef: json.razorpay_account_id,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    };
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const at = (unix: unknown): Date => new Date(num(unix) * 1000);
const notesPurchase = (e: Record<string, unknown> | undefined): string | null =>
  e ? str(((e.notes ?? {}) as { purchase_id?: unknown }).purchase_id) : null;

export function mapRazorpayEvent(
  eventId: string,
  event: {
    event: string;
    created_at: number;
    payload: Record<string, { entity: Record<string, unknown> }>;
  },
): PaymentEvent[] {
  const pay = event.payload.payment?.entity;
  const sub = event.payload.subscription?.entity;
  const link = event.payload.payment_link?.entity;
  const succeeded = (
    checkoutRef: string | null,
    subscriptionRef: string | null,
    periodEnd: Date | null,
  ): PaymentEvent[] =>
    pay
      ? [
          {
            type: 'payment_succeeded',
            eventId: `${eventId}:payment`,
            paymentRef: String(pay.id),
            checkoutRef,
            subscriptionRef,
            amountMinor: num(pay.amount),
            taxMinor: num(pay.tax),
            currency: String(pay.currency ?? '').toUpperCase(),
            method: METHODS[String(pay.method)] ?? 'other',
            paidAt: at(pay.created_at ?? event.created_at),
            periodEnd,
          },
        ]
      : [];
  switch (event.event) {
    case 'payment_link.paid':
      if (!link) return [];
      return [
        {
          type: 'checkout_completed',
          eventId,
          checkoutRef: String(link.id),
          purchaseId: notesPurchase(link) ?? str(link.reference_id),
          customerRef: null,
          subscriptionRef: null,
        },
        ...succeeded(String(link.id), null, null),
      ];
    case 'subscription.authenticated':
    case 'subscription.activated':
      if (!sub) return [];
      return [
        {
          type: 'checkout_completed',
          eventId,
          checkoutRef: String(sub.id),
          purchaseId: notesPurchase(sub),
          customerRef: str(sub.customer_id),
          subscriptionRef: String(sub.id),
        },
        ...(sub.start_at && num(sub.start_at) > event.created_at
          ? [
              {
                type: 'subscription_updated' as const,
                eventId: `${eventId}:trial`,
                subscriptionRef: String(sub.id),
                status: 'trialing' as const,
                periodEnd: at(sub.start_at),
                cancelAtPeriodEnd: false,
              },
            ]
          : []),
      ];
    case 'subscription.charged':
      if (!sub) return [];
      return [
        {
          type: 'checkout_completed',
          eventId: `${eventId}:checkout`,
          checkoutRef: String(sub.id),
          purchaseId: notesPurchase(sub),
          customerRef: str(sub.customer_id),
          subscriptionRef: String(sub.id),
        },
        ...succeeded(null, String(sub.id), sub.current_end ? at(sub.current_end) : null),
      ];
    case 'subscription.pending':
    case 'subscription.halted':
      if (!sub) return [];
      return [
        {
          type: 'payment_failed',
          eventId,
          paymentRef: pay ? String(pay.id) : null,
          checkoutRef: null,
          subscriptionRef: String(sub.id),
          amountMinor: pay ? num(pay.amount) : 0,
          currency: String(pay?.currency ?? sub.currency ?? 'INR').toUpperCase(),
          failureCode: pay ? str(pay.error_code) : event.event.replace('subscription.', ''),
          at: at(event.created_at),
        },
      ];
    case 'subscription.cancelled':
    case 'subscription.completed':
      if (!sub) return [];
      return [
        {
          type: 'subscription_ended',
          eventId,
          subscriptionRef: String(sub.id),
          at: at(sub.ended_at ?? event.created_at),
        },
      ];
    case 'refund.processed': {
      const refund = event.payload.refund?.entity;
      if (!refund || !pay) return [];
      return [
        {
          type: 'refunded',
          eventId,
          paymentRef: String(pay.id),
          refundedMinor: num(pay.amount_refunded) || num(refund.amount),
        },
      ];
    }
    default:
      return [];
  }
}
