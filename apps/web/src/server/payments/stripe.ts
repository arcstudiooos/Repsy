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
 * PRD K1 (D-013 #1, #3): Stripe Connect with Standard accounts. Every API call runs on the coach's own account
 * (`Stripe-Account`), so payouts, disputes and Stripe Tax live in their Stripe. REST over `fetch`, form-encoded; no SDK.
 * Enabled when STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_CLIENT_ID are set.
 */
const API = 'https://api.stripe.com/v1';
export const STRIPE_TOLERANCE_S = 300;

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  connectClientId: string;
}

type Fetch = typeof fetch;

/** Stripe's nested form encoding: a[b][0][c]=v. */
export function formEncode(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === 'object') {
      out.push(...formEncode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Stripe request failed (${status}${code ? `, ${code}` : ''})`);
    this.name = 'StripeError';
  }
}

const METHODS: Record<string, PaymentMethod> = { card: 'card', upi: 'upi' };

export class StripePayments implements PaymentsPort {
  readonly provider = 'stripe' as const;

  constructor(
    private readonly config: StripeConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    account: string | null,
    params: Record<string, unknown> = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const body = formEncode(params).join('&');
    const res = await this.fetchImpl(`${API}${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(account ? { 'stripe-account': account } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(method === 'GET' ? {} : { body }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string };
      throw new StripeError(res.status, err.code ?? null);
    }
    return json as T;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const acct = req.account.accountRef;
    const subscription = req.mode === 'subscription';
    const discount = subscription ? req.recurringMinor - req.firstChargeMinor : 0;
    let couponId: string | undefined;
    if (discount > 0) {
      // A first-charge discount (D-013 #5) is a one-off Stripe coupon on the coach's account.
      const coupon = await this.call<{ id: string }>(
        'POST',
        '/coupons',
        acct,
        { amount_off: discount, currency: req.currency.toLowerCase(), duration: 'once' },
        `repsy-coupon-${req.purchaseId}`,
      );
      couponId = coupon.id;
    }
    const session = await this.call<{ id: string; url: string }>(
      'POST',
      '/checkout/sessions',
      acct,
      {
        mode: subscription ? 'subscription' : 'payment',
        customer_email: req.buyerEmail,
        client_reference_id: req.purchaseId,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        metadata: { purchase_id: req.purchaseId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: req.currency.toLowerCase(),
              unit_amount: subscription ? req.recurringMinor : req.firstChargeMinor,
              product_data: { name: req.title },
              ...(subscription && req.interval
                ? { recurring: { interval: req.interval.unit, interval_count: req.interval.count } }
                : {}),
            },
          },
        ],
        ...(subscription
          ? {
              subscription_data: {
                metadata: { purchase_id: req.purchaseId },
                ...(req.trialDays > 0 ? { trial_period_days: req.trialDays } : {}),
              },
            }
          : { payment_intent_data: { metadata: { purchase_id: req.purchaseId } } }),
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        ...(req.automaticTax ? { automatic_tax: { enabled: true } } : {}),
      },
      `repsy-checkout-${req.purchaseId}`,
    );
    return { url: session.url, checkoutRef: session.id };
  }

  async cancelSubscription(
    account: ConnectedAccount,
    subscriptionRef: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    if (atPeriodEnd) {
      await this.call(
        'POST',
        `/subscriptions/${encodeURIComponent(subscriptionRef)}`,
        account.accountRef,
        {
          cancel_at_period_end: true,
        },
      );
    } else {
      await this.call(
        'DELETE',
        `/subscriptions/${encodeURIComponent(subscriptionRef)}`,
        account.accountRef,
      );
    }
  }

  async refund(account: ConnectedAccount, paymentRef: string, amountMinor: number): Promise<void> {
    await this.call('POST', '/refunds', account.accountRef, {
      payment_intent: paymentRef,
      amount: amountMinor,
    });
  }

  async manageUrl(
    account: ConnectedAccount,
    refs: { customerRef: string | null; returnUrl: string },
  ): Promise<string | null> {
    if (!refs.customerRef) return null;
    const s = await this.call<{ url: string }>(
      'POST',
      '/billing_portal/sessions',
      account.accountRef,
      {
        customer: refs.customerRef,
        return_url: refs.returnUrl,
      },
    );
    return s.url;
  }

  /** Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">; 5-minute tolerance (D-013 #3). */
  verify(rawBody: string, header: string | null, now: Date): void {
    const parts = new Map<string, string[]>();
    for (const kv of (header ?? '').split(',')) {
      const [k, v] = kv.split('=');
      if (!k || v === undefined) continue;
      parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
    }
    const t = Number(parts.get('t')?.[0]);
    if (!Number.isFinite(t) || Math.abs(now.getTime() / 1000 - t) > STRIPE_TOLERANCE_S) {
      throw new WebhookSignatureError();
    }
    const want = createHmac('sha256', this.config.webhookSecret).update(`${t}.${rawBody}`).digest();
    const ok = (parts.get('v1') ?? []).some((sig) => {
      const got = Buffer.from(sig, 'hex');
      return got.length === want.length && timingSafeEqual(got, want);
    });
    if (!ok) throw new WebhookSignatureError();
  }

  parseWebhook(rawBody: string, headers: Headers, now: Date): WebhookBatch {
    this.verify(rawBody, headers.get('stripe-signature'), now);
    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      account?: string;
      created: number;
      data: { object: Record<string, unknown> };
    };
    if (!event.account) return { accountRef: '', events: [] };
    return { accountRef: event.account, events: mapStripeEvent(event) };
  }

  /** The Connect OAuth start (K1): a Standard account, read_write. */
  connectUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.connectClientId,
      scope: 'read_write',
      state,
      redirect_uri: redirectUri,
    });
    return `https://connect.stripe.com/oauth/authorize?${q.toString()}`;
  }

  async completeConnect(code: string): Promise<{ accountRef: string }> {
    const res = await this.fetchImpl('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as {
      stripe_user_id?: string;
      error?: string;
    };
    if (!res.ok || !json.stripe_user_id) throw new StripeError(res.status, json.error ?? null);
    return { accountRef: json.stripe_user_id };
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const at = (unix: unknown): Date => new Date(num(unix) * 1000);
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? str((v as { id?: unknown }).id) : null;

export function mapStripeEvent(event: {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}): PaymentEvent[] {
  const o = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      // A delayed method (voucher, bank debit) completes the session unpaid: nothing is active until the money
      // arrives, as `async_payment_succeeded` (security review F1). A trial completes with no payment required.
      if (o.payment_status !== 'paid' && o.payment_status !== 'no_payment_required') return [];
      const out: PaymentEvent[] = [
        {
          type: 'checkout_completed',
          eventId: event.id,
          checkoutRef: String(o.id),
          purchaseId: str(o.client_reference_id),
          customerRef: idOf(o.customer),
          subscriptionRef: idOf(o.subscription),
        },
      ];
      if (o.mode === 'payment' && o.payment_status === 'paid') {
        const totals = (o.total_details ?? {}) as Record<string, unknown>;
        out.push({
          type: 'payment_succeeded',
          eventId: `${event.id}:payment`,
          paymentRef: idOf(o.payment_intent) ?? String(o.id),
          checkoutRef: String(o.id),
          subscriptionRef: null,
          amountMinor: num(o.amount_total),
          taxMinor: num(totals.amount_tax),
          currency: String(o.currency ?? '').toUpperCase(),
          method: 'card',
          paidAt: at(event.created),
          periodEnd: null,
        });
      }
      return out;
    }
    case 'invoice.paid': {
      if (num(o.amount_paid) === 0 || !idOf(o.subscription)) return [];
      const line = (((o.lines ?? {}) as { data?: { period?: { end?: number } }[] }).data ?? [])[0];
      return [
        {
          type: 'payment_succeeded',
          eventId: event.id,
          paymentRef: idOf(o.payment_intent) ?? String(o.id),
          checkoutRef: null,
          subscriptionRef: idOf(o.subscription),
          amountMinor: num(o.amount_paid),
          taxMinor: num(o.tax),
          currency: String(o.currency ?? '').toUpperCase(),
          method:
            METHODS[
              String(
                (o.payment_settings as { payment_method_types?: string[] } | undefined)
                  ?.payment_method_types?.[0] ?? 'card',
              )
            ] ?? 'card',
          paidAt: at(event.created),
          periodEnd: line?.period?.end ? at(line.period.end) : null,
        },
      ];
    }
    case 'invoice.payment_failed':
      return [
        {
          type: 'payment_failed',
          eventId: event.id,
          paymentRef: idOf(o.payment_intent),
          checkoutRef: null,
          subscriptionRef: idOf(o.subscription),
          amountMinor: num(o.amount_due),
          currency: String(o.currency ?? '').toUpperCase(),
          failureCode:
            str(((o.last_finalization_error ?? {}) as { code?: string }).code) ?? 'payment_failed',
          at: at(event.created),
        },
      ];
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const s = String(o.status);
      const status =
        s === 'trialing'
          ? 'trialing'
          : s === 'active'
            ? 'active'
            : s === 'canceled'
              ? 'canceled'
              : ['past_due', 'unpaid', 'incomplete'].includes(s)
                ? 'past_due'
                : null;
      if (!status) return [];
      return [
        {
          type: 'subscription_updated',
          eventId: event.id,
          subscriptionRef: String(o.id),
          status,
          periodEnd: o.current_period_end
            ? at(o.current_period_end)
            : o.trial_end
              ? at(o.trial_end)
              : null,
          cancelAtPeriodEnd: o.cancel_at_period_end === true,
        },
      ];
    }
    case 'customer.subscription.deleted':
      return [
        {
          type: 'subscription_ended',
          eventId: event.id,
          subscriptionRef: String(o.id),
          at: at(o.ended_at ?? event.created),
        },
      ];
    case 'charge.refunded': {
      const ref = idOf(o.payment_intent);
      if (!ref) return [];
      return [
        {
          type: 'refunded',
          eventId: event.id,
          paymentRef: ref,
          refundedMinor: num(o.amount_refunded),
        },
      ];
    }
    default:
      return [];
  }
}
