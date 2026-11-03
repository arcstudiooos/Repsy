import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookSignatureError } from '@kinetic/core';
import { RazorpayCouponUnsupported, RazorpayPayments } from '@/server/payments/razorpay';
import { formEncode, StripePayments } from '@/server/payments/stripe';

const NOW = new Date('2026-11-04T15:00:00Z');
const unix = Math.floor(NOW.getTime() / 1000);

/** A fetch that records requests and answers from a queue. */
function mockFetch(answers: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const req = {
  account: { provider: 'stripe' as const, accountRef: 'acct_123' },
  purchaseId: '00000000-0000-4000-8000-000000000001',
  currency: 'USD',
  title: 'Monthly coaching',
  buyerEmail: 'b@example.test',
  successUrl: 'https://app.test/ok',
  cancelUrl: 'https://app.test/no',
  automaticTax: true,
  trialDays: 7,
};

describe('Stripe adapter (K1)', () => {
  const config = { secretKey: 'sk_test', webhookSecret: 'whsec_test', connectClientId: 'ca_test' };

  it('encodes nested params the Stripe way', () => {
    expect(formEncode({ a: { b: [{ c: 1 }], d: 'x y' }, e: true }).join('&')).toBe(
      'a%5Bb%5D%5B0%5D%5Bc%5D=1&a%5Bd%5D=x%20y&e=true',
    );
  });

  it('creates a subscription checkout on the connected account with a one-off coupon for a first-charge discount', async () => {
    const { calls, impl } = mockFetch([
      { id: 'co_1' },
      { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' },
    ]);
    const stripe = new StripePayments(config, impl);
    const out = await stripe.createCheckout({
      ...req,
      mode: 'subscription',
      firstChargeMinor: 8900,
      recurringMinor: 9900,
      interval: { unit: 'month', count: 1 },
    });
    expect(out).toEqual({ url: 'https://checkout.stripe.test/cs_1', checkoutRef: 'cs_1' });
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/coupons');
    expect(new Headers(calls[0]!.init.headers).get('stripe-account')).toBe('acct_123');
    const body = decodeURIComponent(String(calls[1]!.init.body));
    expect(body).toContain('mode=subscription');
    expect(body).toContain('line_items[0][price_data][unit_amount]=9900');
    expect(body).toContain('line_items[0][price_data][recurring][interval]=month');
    expect(body).toContain('subscription_data[trial_period_days]=7');
    expect(body).toContain('discounts[0][coupon]=co_1');
    expect(body).toContain('automatic_tax[enabled]=true');
    expect(body).toContain(`client_reference_id=${req.purchaseId}`);
    expect(new Headers(calls[1]!.init.headers).get('idempotency-key')).toBe(
      `repsy-checkout-${req.purchaseId}`,
    );
  });

  it('verifies signatures with a 5-minute tolerance and maps events', () => {
    const stripe = new StripePayments(config);
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      account: 'acct_123',
      created: unix,
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status: 'paid',
          client_reference_id: req.purchaseId,
          customer: 'cus_1',
          payment_intent: 'pi_1',
          amount_total: 5000,
          currency: 'usd',
          total_details: { amount_tax: 400 },
        },
      },
    };
    const body = JSON.stringify(event);
    const sig = (t: number) =>
      `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')}`;
    const batch = stripe.parseWebhook(body, new Headers({ 'stripe-signature': sig(unix) }), NOW);
    expect(batch.accountRef).toBe('acct_123');
    expect(batch.events.map((e) => e.type)).toEqual(['checkout_completed', 'payment_succeeded']);
    expect(batch.events[1]).toMatchObject({
      paymentRef: 'pi_1',
      amountMinor: 5000,
      taxMinor: 400,
      currency: 'USD',
    });
    expect(() =>
      stripe.parseWebhook(body, new Headers({ 'stripe-signature': sig(unix - 301) }), NOW),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      stripe.parseWebhook(`${body} `, new Headers({ 'stripe-signature': sig(unix) }), NOW),
    ).toThrow(WebhookSignatureError);
  });

  it('maps subscription invoices, failures, cancellations and refunds', () => {
    const stripe = new StripePayments(config);
    const send = (type: string, object: Record<string, unknown>) => {
      const body = JSON.stringify({
        id: `evt_${type}`,
        type,
        account: 'acct_123',
        created: unix,
        data: { object },
      });
      const s = `t=${unix},v1=${createHmac('sha256', 'whsec_test').update(`${unix}.${body}`).digest('hex')}`;
      return stripe.parseWebhook(body, new Headers({ 'stripe-signature': s }), NOW).events;
    };
    expect(send('invoice.paid', { id: 'in_1', amount_paid: 0, subscription: 'sub_1' })).toEqual([]);
    // A delayed method completes the session unpaid: nothing activates until the money arrives.
    const session = { id: 'cs_9', mode: 'payment', client_reference_id: 'p', amount_total: 100 };
    expect(send('checkout.session.completed', { ...session, payment_status: 'unpaid' })).toEqual(
      [],
    );
    expect(
      send('checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' }).map(
        (e) => e.type,
      ),
    ).toEqual(['checkout_completed', 'payment_succeeded']);
    expect(
      send('checkout.session.completed', {
        ...session,
        mode: 'subscription',
        subscription: 'sub_9',
        payment_status: 'no_payment_required',
      }).map((e) => e.type),
    ).toEqual(['checkout_completed']);
    expect(
      send('invoice.paid', {
        id: 'in_2',
        amount_paid: 9900,
        subscription: 'sub_1',
        payment_intent: 'pi_2',
        currency: 'usd',
        lines: { data: [{ period: { end: unix + 86400 * 30 } }] },
      })[0],
    ).toMatchObject({
      type: 'payment_succeeded',
      subscriptionRef: 'sub_1',
      paymentRef: 'pi_2',
      amountMinor: 9900,
    });
    expect(
      send('invoice.payment_failed', {
        id: 'in_3',
        subscription: 'sub_1',
        amount_due: 9900,
        currency: 'usd',
      })[0],
    ).toMatchObject({
      type: 'payment_failed',
      subscriptionRef: 'sub_1',
    });
    expect(
      send('customer.subscription.updated', {
        id: 'sub_1',
        status: 'unpaid',
        cancel_at_period_end: false,
      })[0],
    ).toMatchObject({
      type: 'subscription_updated',
      status: 'past_due',
    });
    expect(send('customer.subscription.deleted', { id: 'sub_1', ended_at: unix })[0]).toMatchObject(
      { type: 'subscription_ended' },
    );
    expect(
      send('charge.refunded', { payment_intent: 'pi_2', amount_refunded: 500 })[0],
    ).toMatchObject({
      type: 'refunded',
      refundedMinor: 500,
    });
  });
});

describe('Razorpay adapter (K2)', () => {
  const config = { clientId: 'rzp_client', clientSecret: 'secret', webhookSecret: 'rzp_whsec' };
  const account = { provider: 'razorpay' as const, accountRef: 'acc_1', accessToken: 'tok' };

  it('uses payment links for one-offs and plans plus subscriptions for recurring; refuses a first-charge coupon there', async () => {
    const { calls, impl } = mockFetch([
      { id: 'plink_1', short_url: 'https://rzp.io/l/1' },
      { id: 'plan_1' },
      { id: 'sub_1', short_url: 'https://rzp.io/s/1' },
    ]);
    const rzp = new RazorpayPayments(config, impl);
    const one = await rzp.createCheckout({
      ...req,
      account,
      currency: 'INR',
      mode: 'payment',
      firstChargeMinor: 49900,
      recurringMinor: 49900,
      trialDays: 0,
    });
    expect(one).toEqual({ url: 'https://rzp.io/l/1', checkoutRef: 'plink_1' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      amount: 49900,
      currency: 'INR',
      reference_id: req.purchaseId,
    });
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer tok');
    const sub = await rzp.createCheckout({
      ...req,
      account,
      currency: 'INR',
      mode: 'subscription',
      firstChargeMinor: 99900,
      recurringMinor: 99900,
      interval: { unit: 'month', count: 1 },
      installments: 3,
      trialDays: 0,
    });
    expect(sub.checkoutRef).toBe('sub_1');
    expect(JSON.parse(String(calls[2]!.init.body))).toMatchObject({
      plan_id: 'plan_1',
      total_count: 3,
    });
    await expect(
      rzp.createCheckout({
        ...req,
        account,
        mode: 'subscription',
        firstChargeMinor: 1,
        recurringMinor: 2,
        interval: { unit: 'month', count: 1 },
        trialDays: 0,
      }),
    ).rejects.toBeInstanceOf(RazorpayCouponUnsupported);
  });

  it('verifies X-Razorpay-Signature and maps link payments, charges, failures and refunds', () => {
    const rzp = new RazorpayPayments(config);
    const send = (event: string, payload: Record<string, unknown>, created = unix) => {
      const body = JSON.stringify({ event, account_id: 'acc_1', created_at: created, payload });
      return rzp.parseWebhook(
        body,
        new Headers({
          'x-razorpay-signature': createHmac('sha256', 'rzp_whsec').update(body).digest('hex'),
          'x-razorpay-event-id': `ev_${event}`,
        }),
        NOW,
      );
    };
    const paid = send('payment_link.paid', {
      payment_link: {
        entity: {
          id: 'plink_1',
          reference_id: req.purchaseId,
          notes: { purchase_id: req.purchaseId },
        },
      },
      payment: {
        entity: { id: 'pay_1', amount: 49900, currency: 'INR', method: 'upi', created_at: unix },
      },
    });
    expect(paid.accountRef).toBe('acc_1');
    expect(paid.events.map((e) => e.type)).toEqual(['checkout_completed', 'payment_succeeded']);
    expect(paid.events[1]).toMatchObject({
      method: 'upi',
      amountMinor: 49900,
      paymentRef: 'pay_1',
    });
    expect(
      send('subscription.charged', {
        subscription: {
          entity: {
            id: 'sub_1',
            notes: { purchase_id: req.purchaseId },
            current_end: unix + 86400 * 30,
          },
        },
        payment: { entity: { id: 'pay_2', amount: 99900, currency: 'INR', method: 'card' } },
      }).events.map((e) => e.type),
    ).toEqual(['checkout_completed', 'payment_succeeded']);
    expect(
      send('subscription.halted', { subscription: { entity: { id: 'sub_1', currency: 'INR' } } })
        .events[0],
    ).toMatchObject({
      type: 'payment_failed',
      subscriptionRef: 'sub_1',
    });
    expect(
      send('refund.processed', {
        refund: { entity: { id: 'rfnd_1', amount: 100 } },
        payment: { entity: { id: 'pay_1', amount_refunded: 100 } },
      }).events[0],
    ).toMatchObject({ type: 'refunded', paymentRef: 'pay_1', refundedMinor: 100 });
    expect(() =>
      rzp.parseWebhook('{}', new Headers({ 'x-razorpay-signature': 'deadbeef' })),
    ).toThrow(WebhookSignatureError);

    // Replays: the id comes from the signed body, not the header; an old body is refused.
    const halted = { subscription: { entity: { id: 'sub_1', currency: 'INR' } } };
    expect(send('subscription.halted', halted).events[0]?.eventId).toMatch(/^rzp_[0-9a-f]{64}/);
    expect(() => send('subscription.halted', halted, unix - 3 * 86400)).toThrow(
      WebhookSignatureError,
    );
    // A mandate alone activates nothing unless a trial comes first.
    const sub = { id: 'sub_2', notes: { purchase_id: req.purchaseId } };
    expect(send('subscription.authenticated', { subscription: { entity: sub } }).events).toEqual(
      [],
    );
    expect(
      send('subscription.authenticated', {
        subscription: { entity: { ...sub, start_at: unix + 7 * 86400 } },
      }).events.map((e) => e.type),
    ).toEqual(['checkout_completed', 'subscription_updated']);
  });
});
