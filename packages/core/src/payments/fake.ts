import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { addInterval } from './money';
import {
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutResult,
  type ConnectedAccount,
  type PaymentEvent,
  type PaymentsPort,
  type WebhookBatch,
} from './port';

/**
 * D-013 #1: the deterministic payment provider for development and tests. Its "hosted checkout" is the app's own
 * `/dev/checkout/<ref>` page, which pays or declines by posting a signed fake webhook, so the whole purchase path
 * (checkout, webhook, activation, receipts, failures) runs without any provider account. Never used in production.
 */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

type WireEvent = Omit<PaymentEvent, 'paidAt' | 'periodEnd' | 'at'> & {
  paidAt?: string;
  periodEnd?: string | null;
  at?: string;
};

export function signFakeWebhook(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Builds the JSON body of a fake webhook (what the dev checkout page and tests post). */
export function fakeWebhookBody(accountRef: string, events: PaymentEvent[]): string {
  return JSON.stringify({
    accountRef,
    events: events.map((e) => {
      const out: Record<string, unknown> = { ...e };
      for (const k of ['paidAt', 'periodEnd', 'at'] as const) {
        const v = (e as Record<string, unknown>)[k];
        if (v instanceof Date) out[k] = v.toISOString();
      }
      return out;
    }),
  });
}

/** The events the dev checkout page sends for "Pay": the checkout and its first charge (or a trial start). */
export function fakeCheckoutPaidEvents(input: {
  checkoutRef: string;
  purchaseId: string;
  amountMinor: number;
  currency: string;
  mode: 'payment' | 'subscription';
  interval?: { unit: 'week' | 'month'; count: number };
  trialDays: number;
  now: Date;
}): PaymentEvent[] {
  const id = () => `evt_fake_${randomBytes(9).toString('hex')}`;
  const subscriptionRef =
    input.mode === 'subscription' ? `sub_fake_${input.checkoutRef.slice(-12)}` : null;
  const events: PaymentEvent[] = [
    {
      type: 'checkout_completed',
      eventId: id(),
      checkoutRef: input.checkoutRef,
      purchaseId: input.purchaseId,
      customerRef: `cus_fake_${input.checkoutRef.slice(-12)}`,
      subscriptionRef,
    },
  ];
  if (input.trialDays > 0 && subscriptionRef) {
    events.push({
      type: 'subscription_updated',
      eventId: id(),
      subscriptionRef,
      status: 'trialing',
      periodEnd: new Date(input.now.getTime() + input.trialDays * 86_400_000),
      cancelAtPeriodEnd: false,
    });
    return events;
  }
  events.push({
    type: 'payment_succeeded',
    eventId: id(),
    paymentRef: `pay_fake_${randomBytes(9).toString('hex')}`,
    checkoutRef: input.checkoutRef,
    subscriptionRef,
    amountMinor: input.amountMinor,
    taxMinor: 0,
    currency: input.currency,
    method: 'card',
    paidAt: input.now,
    periodEnd: input.interval
      ? addInterval(input.now, input.interval.unit, input.interval.count)
      : null,
  });
  return events;
}

function reviveDates(e: WireEvent): PaymentEvent {
  const out: Record<string, unknown> = { ...e };
  for (const k of ['paidAt', 'periodEnd', 'at'] as const) {
    const v = out[k];
    if (typeof v === 'string') out[k] = new Date(v);
  }
  return out as unknown as PaymentEvent;
}

export interface FakeCall {
  method: 'createCheckout' | 'cancelSubscription' | 'refund';
  args: unknown[];
}

export class FakePayments implements PaymentsPort {
  readonly provider = 'fake' as const;
  /** Every call, for tests. */
  readonly calls: FakeCall[] = [];

  constructor(
    private readonly secret: string,
    /** The app's origin, where `/dev/checkout` lives. */
    private readonly appBaseUrl: string,
  ) {}

  createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    this.calls.push({ method: 'createCheckout', args: [req] });
    const checkoutRef = `cs_fake_${randomBytes(12).toString('hex')}`;
    const q = new URLSearchParams({
      purchase: req.purchaseId,
      account: req.account.accountRef,
      amount: String(req.firstChargeMinor),
      currency: req.currency,
      mode: req.mode,
      title: req.title,
      trial: String(req.trialDays),
      success: req.successUrl,
      cancel: req.cancelUrl,
      ...(req.interval ? { unit: req.interval.unit, count: String(req.interval.count) } : {}),
    });
    return Promise.resolve({
      url: `${this.appBaseUrl}/dev/checkout/${checkoutRef}?${q.toString()}`,
      checkoutRef,
    });
  }

  cancelSubscription(
    account: ConnectedAccount,
    subscriptionRef: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    this.calls.push({
      method: 'cancelSubscription',
      args: [account, subscriptionRef, atPeriodEnd],
    });
    return Promise.resolve();
  }

  refund(account: ConnectedAccount, paymentRef: string, amountMinor: number): Promise<void> {
    this.calls.push({ method: 'refund', args: [account, paymentRef, amountMinor] });
    return Promise.resolve();
  }

  /** No hosted page in development: the "Update card" link just returns to the billing page. */
  manageUrl(
    _account: ConnectedAccount,
    refs: { customerRef: string | null; subscriptionRef: string | null; returnUrl: string },
  ): Promise<string | null> {
    return Promise.resolve(refs.subscriptionRef || refs.customerRef ? refs.returnUrl : null);
  }

  parseWebhook(rawBody: string, headers: Headers): WebhookBatch {
    const given = headers.get(FAKE_SIGNATURE_HEADER) ?? '';
    const want = signFakeWebhook(this.secret, rawBody);
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(want, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError();
    let parsed: { accountRef?: unknown; events?: unknown };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      throw new WebhookSignatureError('Malformed webhook body.');
    }
    if (typeof parsed.accountRef !== 'string' || !Array.isArray(parsed.events)) {
      throw new WebhookSignatureError('Malformed webhook body.');
    }
    return {
      accountRef: parsed.accountRef,
      events: (parsed.events as WireEvent[]).map(reviveDates),
    };
  }
}
