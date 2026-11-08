import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import {
  cancelSubscription,
  chargeDueRenewal,
  confirmCheckout,
  getReceipt,
  handleFailedPayment,
  recordManualPayment,
  refundPayment,
  retryDueSubscription,
} from './billing';
import { createCheckout, saveCoupon, savePackage } from './packages';

/** Money paths against Postgres (review M1-M6, L2, L5): tax, renewals, plans, retries, refunds, coupons. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let m: ClientWorld;

const DAY = 86_400_000;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const sys = <T>(fn: Parameters<typeof withSystem<T>>[0]) => withSystem(fn, prisma);
const as = <T>(fn: Parameters<typeof runAs<T>>[2]) => runAs(prisma, m.coach, fn);
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  m = await newClientWorld(prisma, await newOrg(prisma));
});
afterAll(async () => {
  await drop();
});

const checkout = (packageId: string, couponCode?: string) =>
  as((tx) =>
    createCheckout(
      tx,
      m.coach,
      { packageId, clientId: m.clientId, customerEmail: 'buyer@example.test', couponCode },
      undefined,
      NOW,
    ),
  );
const pkg = (data: Record<string, unknown>) =>
  as((tx) =>
    savePackage(tx, m.coach, {
      title: `P ${Math.random()}`,
      amountMinor: 10000,
      currency: 'USD',
      kind: 'one_off',
      ...data,
    }),
  ).then((r) => r.id);

describe('money paths', () => {
  it('M1: subscription receipts carry the tax the amount includes', async () => {
    const { subscriptionId } = await checkout(
      await pkg({ kind: 'recurring', interval: 'month', currency: 'INR' }),
    );
    const { receiptId } = await as((tx) => confirmCheckout(tx, m.coach, { subscriptionId }, NOW));
    const receipt = await as((tx) => getReceipt(tx, m.coach, receiptId!));
    expect(receipt.amountMinor).toBe(11800);
    expect(receipt.taxMinor).toBe(1800);
    expect(receipt.taxRateBps).toBe(1800);
  });

  it('M2/M3: plan installments charge when due, advance, and leave a payment and receipt', async () => {
    const { subscriptionId } = await checkout(await pkg({ kind: 'payment_plan', installments: 2 }));
    const id = subscriptionId!;
    await as((tx) => confirmCheckout(tx, m.coach, { subscriptionId: id }, NOW));
    const dueAt = new Date('2026-12-04T13:00:00.000Z');
    let sub = await sys((tx) => tx.subscription.findUniqueOrThrow({ where: { id } }));
    expect(sub.installmentsPaid).toBe(1);
    expect(sub.nextChargeAt).toEqual(dueAt);
    expect(await as((tx) => chargeDueRenewal(tx, m.orgId, id, undefined, later(DAY)))).toBeNull();
    expect(await as((tx) => chargeDueRenewal(tx, m.orgId, id, undefined, dueAt))).toEqual({
      status: 'active',
    });
    sub = await sys((tx) => tx.subscription.findUniqueOrThrow({ where: { id } }));
    expect(sub.installmentsPaid).toBe(2);
    expect(sub.nextChargeAt).toBeNull(); // the last installment is paid
    const paid = await sys((tx) =>
      tx.payment.findMany({ where: { subscriptionId: id }, include: { receipts: true } }),
    );
    expect(paid).toHaveLength(2);
    expect(paid.every((p) => p.paidAt !== null && p.receipts.length === 1)).toBe(true);
    // Cancelling a paid-up plan ends at the end of the last paid month.
    const { endsAt } = await as((tx) => cancelSubscription(tx, m.coach, id, dueAt));
    expect(endsAt).toBe('2027-01-04T13:00:00.000Z');
  });

  it('M2: a confirmed recurring subscription is next charged one period later, not at once', async () => {
    const { subscriptionId } = await checkout(await pkg({ kind: 'recurring', interval: 'week' }));
    await as((tx) => confirmCheckout(tx, m.coach, { subscriptionId }, NOW));
    expect(
      await as((tx) => chargeDueRenewal(tx, m.orgId, subscriptionId!, undefined, later(DAY))),
    ).toBeNull();
    expect(
      await as((tx) => chargeDueRenewal(tx, m.orgId, subscriptionId!, undefined, later(7 * DAY))),
    ).toEqual({ status: 'active' });
  });

  it('M3: a successful retry is a payment with a receipt', async () => {
    const { subscriptionId } = await checkout(await pkg({ kind: 'recurring', interval: 'month' }));
    const id = subscriptionId!;
    await as((tx) => confirmCheckout(tx, m.coach, { subscriptionId: id }, NOW));
    await as((tx) => handleFailedPayment(tx, m.coach, { subscriptionId: id }, NOW));
    expect(
      await as((tx) => retryDueSubscription(tx, m.orgId, id, undefined, later(DAY + 1))),
    ).toEqual({ status: 'active' });
    expect(await sys((tx) => tx.payment.count({ where: { subscriptionId: id } }))).toBe(2);
    expect(
      await sys((tx) => tx.receipt.count({ where: { payment: { is: { subscriptionId: id } } } })),
    ).toBe(2);
  });

  it('a trial checkout that was never confirmed is not charged when the trial ends', async () => {
    const { subscriptionId } = await checkout(
      await pkg({ kind: 'recurring', interval: 'month', trialDays: 7 }),
    );
    expect(
      await as((tx) => chargeDueRenewal(tx, m.orgId, subscriptionId!, undefined, later(8 * DAY))),
    ).toBeNull();
  });

  it('M4: a partly refunded payment can be refunded again, never past its amount', async () => {
    const { paymentId } = await checkout(await pkg({}));
    await as((tx) => confirmCheckout(tx, m.coach, { paymentId }, NOW));
    const refund = (amountMinor: number) =>
      codeOf(as((tx) => refundPayment(tx, m.coach, { paymentId, amountMinor })));
    expect(await refund(3000)).toBe('ok');
    expect(await refund(3000)).toBe('ok');
    expect(await refund(5000)).toBe('CONFLICT'); // only 4000 left
    expect(await refund(4000)).toBe('ok');
    const p = await sys((tx) => tx.payment.findUniqueOrThrow({ where: { id: paymentId! } }));
    expect(p.status).toBe('refunded');
    expect(p.refundedMinor).toBe(10000);
  });

  it('M6: open checkouts hold capped coupon uses; a duplicate code is a field error', async () => {
    await as((tx) =>
      saveCoupon(tx, m.coach, {
        code: 'ONLYTWO',
        kind: 'fixed',
        value: 100,
        currency: 'USD',
        usageCap: 2,
      }),
    );
    const one = await pkg({});
    expect(await codeOf(checkout(one, 'ONLYTWO'))).toBe('ok');
    expect(await codeOf(checkout(one, 'ONLYTWO'))).toBe('ok');
    expect(await codeOf(checkout(one, 'ONLYTWO'))).toBe('CONFLICT');
    expect(
      await codeOf(
        as((tx) => saveCoupon(tx, m.coach, { code: 'onlytwo', kind: 'percentage', value: 5 })),
      ),
    ).toBe('VALIDATION');
  });

  it('L2: running out of retries with no grace pauses access', async () => {
    const { subscriptionId } = await checkout(await pkg({ kind: 'recurring', interval: 'month' }));
    const id = subscriptionId!;
    await as((tx) => confirmCheckout(tx, m.coach, { subscriptionId: id }, NOW));
    for (const n of [0, 1, 2, 3]) {
      await as((tx) => handleFailedPayment(tx, m.coach, { subscriptionId: id }, later(n * DAY)));
    }
    const sub = await sys((tx) => tx.subscription.findUniqueOrThrow({ where: { id } }));
    expect(sub.status).toBe('paused');
    expect(sub.needsReview).toBe(true);
  });

  it('L5: a manual payment needs a real currency code and a date not in the future', async () => {
    const packageId = await pkg({});
    const record = (extra: Record<string, unknown>) =>
      codeOf(
        as((tx) =>
          recordManualPayment(
            tx,
            m.coach,
            {
              packageId,
              customerEmail: 'cash@example.test',
              amountMinor: 5000,
              method: 'cash',
              ...extra,
            },
            NOW,
          ),
        ),
      );
    expect(await record({ currency: 'dollars' })).toBe('VALIDATION');
    expect(await record({ paidAt: later(2 * DAY).toISOString() })).toBe('VALIDATION');
    expect(await record({ currency: 'eur' })).toBe('ok');
    expect(await record({})).toBe('ok');
  });

  it('a client never reads a receipt for a payment with no client record', async () => {
    const packageId = await pkg({});
    const { receiptId } = await as((tx) =>
      recordManualPayment(
        tx,
        m.coach,
        { packageId, customerEmail: 'walkin@example.test', amountMinor: 100, method: 'cash' },
        NOW,
      ),
    );
    expect(await codeOf(runAs(prisma, m.client, (tx) => getReceipt(tx, m.client, receiptId)))).toBe(
      'NOT_FOUND',
    );
  });
});
