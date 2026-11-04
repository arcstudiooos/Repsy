import { describe, expect, it } from 'vitest';
import { billingCsv, computeBillingAnalytics, monthlyEquivalent } from './analytics';
import { accessPaused, cancellationEndDate, gracePeriodEnd, nextRetryAt } from './billing';
import { calculateTax, FakePaymentsProvider } from './payments';
import {
  applyCoupon,
  couponProblem,
  nextChargeDate,
  paymentPlanSchedule,
  trialEndDate,
} from './packages';

/**
 * Pure-logic tests for the billing slice (K1-K9, K15 price and schedule
 * math). These need no Postgres: they import only the pure functions. The
 * database functions in packages.ts / billing.ts are exercised by the
 * parent's integration pass once the schema snippet is applied.
 */

describe('coupons (K5)', () => {
  it('percentage coupon rounds to the nearest minor unit', () => {
    expect(applyCoupon(10000, { kind: 'percentage', value: 15 })).toEqual({
      discountMinor: 1500,
      totalMinor: 8500,
    });
  });

  it('fixed coupon never takes the total below zero', () => {
    expect(applyCoupon(500, { kind: 'fixed', value: 2000 })).toEqual({
      discountMinor: 500,
      totalMinor: 0,
    });
  });

  it('expired, used-up and wrong-currency coupons are refused', () => {
    const now = new Date('2026-11-03T00:00:00Z');
    expect(
      couponProblem(
        {
          expiresAt: new Date('2026-11-02T00:00:00Z'),
          usageCap: null,
          usedCount: 0,
          currency: null,
        },
        'USD',
        now,
      ),
    ).toBe('This coupon has expired.');
    expect(
      couponProblem({ expiresAt: null, usageCap: 10, usedCount: 10, currency: null }, 'USD', now),
    ).toBe('This coupon has been used up.');
    expect(
      couponProblem({ expiresAt: null, usageCap: null, usedCount: 0, currency: 'INR' }, 'USD', now),
    ).toBe('This coupon is for a different currency.');
    expect(
      couponProblem({ expiresAt: null, usageCap: null, usedCount: 0, currency: null }, 'USD', now),
    ).toBeNull();
  });
});

describe('payment plans and trials (K3)', () => {
  it('3 x $100 plan totals $300 with the remainder on the last installment', () => {
    expect(paymentPlanSchedule(30000, 3)).toEqual([10000, 10000, 10000]);
    expect(paymentPlanSchedule(10001, 3)).toEqual([3333, 3333, 3335]);
    const plan = paymentPlanSchedule(9999, 4);
    expect(plan.reduce((a, b) => a + b, 0)).toBe(9999);
  });

  it('trial end is start plus trial days', () => {
    expect(trialEndDate(new Date('2026-11-03T00:00:00Z'), 14)).toEqual(
      new Date('2026-11-17T00:00:00Z'),
    );
    expect(trialEndDate(new Date('2026-11-03T00:00:00Z'), 0)).toEqual(
      new Date('2026-11-03T00:00:00Z'),
    );
  });

  it('monthly charges clamp to month-end; weekly charges add 7 days', () => {
    expect(nextChargeDate(new Date('2026-01-31T00:00:00Z'), 'month')).toEqual(
      new Date('2026-02-28T00:00:00Z'),
    );
    expect(nextChargeDate(new Date('2026-11-03T00:00:00Z'), 'week')).toEqual(
      new Date('2026-11-10T00:00:00Z'),
    );
  });
});

describe('tax (K6) and the fake provider (K1, K2)', () => {
  it('INR defaults to 18% GST; other currencies default to no tax', () => {
    expect(calculateTax(10000, { currency: 'INR' })).toMatchObject({
      taxMinor: 1800,
      totalMinor: 11800,
      rateBps: 1800,
    });
    expect(calculateTax(10000, { currency: 'USD' })).toMatchObject({
      taxMinor: 0,
      totalMinor: 10000,
    });
  });

  it('tax-inclusive amounts split the tax back out', () => {
    expect(calculateTax(11800, { currency: 'INR', taxInclusive: true })).toMatchObject({
      taxMinor: 1800,
      totalMinor: 11800,
    });
  });

  it('the fake provider mints test checkout URLs and charges nothing', async () => {
    const provider = new FakePaymentsProvider('razorpay');
    const session = await provider.createCheckoutSession({
      providerAccountId: 'acct_fake',
      customerEmail: 'buyer@example.test',
      description: 'Coaching',
      amount: { amountMinor: 10000, currency: 'INR' },
    });
    expect(session.url).toContain('checkout.test/razorpay/');
    expect(session.url).not.toContain('stripe.com');
    expect(session.url).not.toContain('razorpay.com');
    const charge = await provider.createCharge({
      providerAccountId: 'acct_fake',
      customerEmail: 'buyer@example.test',
      amount: { amountMinor: 10000, currency: 'INR' },
      description: 'Coaching',
      idempotencyKey: 'k1',
    });
    expect(charge).toMatchObject({ status: 'succeeded', processorFeeMinor: 0 });
    // Same idempotency key charges once.
    const again = await provider.createCharge({
      providerAccountId: 'acct_fake',
      customerEmail: 'buyer@example.test',
      amount: { amountMinor: 10000, currency: 'INR' },
      description: 'Coaching',
      idempotencyKey: 'k1',
    });
    expect(again.providerChargeId).toBe(charge.providerChargeId);
  });

  it('a forced failure surfaces its reason for the K7 path', async () => {
    const provider = new FakePaymentsProvider('stripe');
    provider.failNextChargeWith = 'card_declined';
    const charge = await provider.createCharge({
      providerAccountId: 'acct_fake',
      customerEmail: 'buyer@example.test',
      amount: { amountMinor: 5000, currency: 'USD' },
      description: 'Retry',
      idempotencyKey: 'k2',
    });
    expect(charge).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
  });
});

describe('failed payments and grace (K7)', () => {
  it('retries after 1, 3 and 7 days, then there are none left', () => {
    const failed = new Date('2026-11-03T00:00:00Z');
    expect(nextRetryAt(failed, 0)).toEqual(new Date('2026-11-04T00:00:00Z'));
    expect(nextRetryAt(failed, 1)).toEqual(new Date('2026-11-06T00:00:00Z'));
    expect(nextRetryAt(failed, 2)).toEqual(new Date('2026-11-10T00:00:00Z'));
    expect(nextRetryAt(failed, 3)).toBeNull();
  });

  it('grace keeps access on until it expires, then access pauses', () => {
    const failed = new Date('2026-11-03T00:00:00Z');
    const graceEnds = gracePeriodEnd(failed, 7);
    expect(graceEnds).toEqual(new Date('2026-11-10T00:00:00Z'));
    expect(gracePeriodEnd(failed, 0)).toBeNull();
    const sub = { status: 'grace' as const, graceEndsAt: graceEnds };
    expect(accessPaused(sub, new Date('2026-11-09T00:00:00Z'))).toBe(false);
    expect(accessPaused(sub, new Date('2026-11-10T00:00:00Z'))).toBe(true);
    expect(accessPaused({ status: 'active' as const, graceEndsAt: null })).toBe(false);
    expect(accessPaused({ status: 'paused' as const, graceEndsAt: null })).toBe(true);
  });
});

describe('cancellation end date (K8)', () => {
  it('a monthly subscription runs to the end of its current period', () => {
    expect(
      cancellationEndDate({
        status: 'active',
        interval: 'month',
        installments: null,
        installmentsPaid: 0,
        currentPeriodEnd: new Date('2026-11-30T00:00:00Z'),
        nextChargeAt: new Date('2026-11-30T00:00:00Z'),
        trialEndsAt: null,
      }),
    ).toEqual(new Date('2026-11-30T00:00:00Z'));
  });

  it('a trial ends at the trial end, not at a period end', () => {
    expect(
      cancellationEndDate({
        status: 'trialing',
        interval: 'month',
        installments: null,
        installmentsPaid: 0,
        currentPeriodEnd: new Date('2026-12-03T00:00:00Z'),
        nextChargeAt: new Date('2026-11-17T00:00:00Z'),
        trialEndsAt: new Date('2026-11-17T00:00:00Z'),
      }),
    ).toEqual(new Date('2026-11-17T00:00:00Z'));
  });
});

describe('revenue dashboard (K9)', () => {
  it('weekly MRR normalises x 52 / 12; plans and one-offs are not MRR', () => {
    expect(monthlyEquivalent(10000, 'month')).toBe(10000);
    expect(monthlyEquivalent(2300, 'week')).toBe(Math.round((2300 * 52) / 12));
    expect(monthlyEquivalent(30000, null)).toBe(0);
  });

  it('MRR, churn, refunds and average client value come from the same rows', () => {
    const now = new Date('2026-11-03T00:00:00Z');
    const result = computeBillingAnalytics(
      [
        {
          status: 'active',
          amountMinor: 9900,
          currency: 'USD',
          interval: 'month',
          cancelledAt: null,
          endsAt: null,
        },
        {
          status: 'active',
          amountMinor: 2300,
          currency: 'USD',
          interval: 'week',
          cancelledAt: null,
          endsAt: null,
        },
        {
          status: 'trialing',
          amountMinor: 9900,
          currency: 'USD',
          interval: 'month',
          cancelledAt: null,
          endsAt: null,
        },
        {
          status: 'cancelled',
          amountMinor: 9900,
          currency: 'USD',
          interval: 'month',
          cancelledAt: new Date('2026-10-20T00:00:00Z'),
          endsAt: new Date('2026-11-20T00:00:00Z'),
        },
        {
          status: 'paused',
          amountMinor: 9900,
          currency: 'USD',
          interval: 'month',
          cancelledAt: null,
          endsAt: null,
        },
      ],
      [
        {
          status: 'succeeded',
          amountMinor: 9900,
          refundedMinor: 0,
          currency: 'USD',
          clientId: 'c1',
          customerEmail: 'a@example.test',
          paidAt: now,
          createdAt: now,
        },
        {
          status: 'succeeded',
          amountMinor: 9900,
          refundedMinor: 9900,
          currency: 'USD',
          clientId: 'c2',
          customerEmail: 'b@example.test',
          paidAt: now,
          createdAt: now,
        },
        {
          status: 'pending',
          amountMinor: 5000,
          refundedMinor: 0,
          currency: 'USD',
          clientId: 'c3',
          customerEmail: 'c@example.test',
          paidAt: null,
          createdAt: now,
        },
      ],
      now,
    );
    expect(result.mrrByCurrency).toEqual([
      { currency: 'USD', mrrMinor: 9900 + Math.round((2300 * 52) / 12) + 9900 },
    ]);
    expect(result.activeSubscriptions).toBe(2);
    expect(result.trialingSubscriptions).toBe(1);
    expect(result.churned30d).toBe(1);
    expect(result.churnPercent30d).toBe(25);
    expect(result.refundsMinor).toBe(9900);
    expect(result.refundCount).toBe(1);
    expect(result.averageClientValueByCurrency).toEqual([
      { currency: 'USD', averageMinor: 4950, payingBuyers: 2 },
    ]);
    expect(result.revenueByCurrency).toEqual([
      { currency: 'USD', grossMinor: 19800, netMinor: 9900 },
    ]);
  });

  it('CSV escapes commas and quotes and ends with a totals row', () => {
    const csv = billingCsv([
      {
        month: '2026-10',
        revenueMinor: 9900,
        currency: 'USD',
        newSubscriptions: 2,
        cancelledSubscriptions: 1,
      },
    ]);
    expect(csv).toBe(
      'month,revenue_minor,currency,new_subscriptions,cancelled_subscriptions\n2026-10,9900,USD,2,1\ntotal,9900,,,\n',
    );
  });
});
