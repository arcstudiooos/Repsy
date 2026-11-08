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
  clientBillingPaused,
  confirmCheckout,
  expireGraces,
  handleFailedPayment,
  retryDueSubscription,
} from './billing';
import { createCheckout, saveCoupon, savePackage } from './packages';

/** PRD K4-K8, J4/J6 against Postgres: confirming a purchase once, purchase journeys, retries and grace expiry. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;

const DAY = 86_400_000;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const sys = <T>(fn: Parameters<typeof withSystem<T>>[0]) => withSystem(fn, prisma);
const coach = <T>(fn: Parameters<typeof runAs<T>>[2]) => runAs(prisma, w.coach, fn);
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  w = await newClientWorld(prisma, await newOrg(prisma));
});
afterAll(async () => {
  await drop();
});

async function recurringPackage(extra: Record<string, unknown> = {}): Promise<string> {
  const { id } = await coach((tx) =>
    savePackage(tx, w.coach, {
      title: `Monthly ${Math.random()}`,
      kind: 'recurring',
      interval: 'month',
      amountMinor: 10000,
      currency: 'USD',
      ...extra,
    }),
  );
  return id;
}

async function subscribe(packageId: string, couponCode?: string): Promise<string> {
  const checkout = await coach((tx) =>
    createCheckout(
      tx,
      w.coach,
      { packageId, clientId: w.clientId, customerEmail: 'buyer@example.test', couponCode },
      undefined,
      NOW,
    ),
  );
  return checkout.subscriptionId!;
}

describe('confirmCheckout (K4, J4, J6)', () => {
  it('confirms a trial once, uses the coupon once, and starts the purchase journeys', async () => {
    await coach((tx) =>
      saveCoupon(tx, w.coach, { code: 'TRIAL10', kind: 'percentage', value: 10, usageCap: 5 }),
    );
    const packageId = await recurringPackage({
      trialDays: 7,
      renewalReminderDays: 3,
      onboardingSequence: { steps: [{ dayOffset: 0, title: 'Welcome call' }] },
    });
    const subscriptionId = await subscribe(packageId, 'TRIAL10');
    const confirm = () => coach((tx) => confirmCheckout(tx, w.coach, { subscriptionId }, NOW));
    expect(await codeOf(confirm())).toBe('ok');
    // The trial stays `trialing` after the first confirm; a second confirm must still be refused.
    expect(await codeOf(confirm())).toBe('CONFLICT');
    expect(await codeOf(confirm())).toBe('CONFLICT');

    const state = await sys(async (tx) => ({
      payments: await tx.payment.count({ where: { subscriptionId } }),
      coupon: await tx.coupon.findFirstOrThrow({ where: { code: 'TRIAL10' } }),
      runs: await tx.packageJourneyRun.count({ where: { packageId, clientId: w.clientId } }),
      renewal: await tx.outboxEmail.count({
        where: { kind: 'package_renewal_reminder', toUserId: w.userId },
      }),
    }));
    expect(state.payments).toBe(1);
    expect(state.coupon.usedCount).toBe(1);
    expect(state.runs).toBe(1);
    expect(state.renewal).toBe(1);
  });

  it('confirms a one-off payment once', async () => {
    const { id: packageId } = await coach((tx) =>
      savePackage(tx, w.coach, {
        title: 'Assessment',
        kind: 'one_off',
        amountMinor: 5000,
        currency: 'USD',
      }),
    );
    const { paymentId } = await coach((tx) =>
      createCheckout(
        tx,
        w.coach,
        { packageId, clientId: w.clientId, customerEmail: 'buyer@example.test' },
        undefined,
        NOW,
      ),
    );
    const confirm = () => coach((tx) => confirmCheckout(tx, w.coach, { paymentId }, NOW));
    expect(await Promise.all([codeOf(confirm()), codeOf(confirm())]).then((r) => r.sort())).toEqual(
      ['CONFLICT', 'ok'],
    );
    expect(await sys((tx) => tx.receipt.count({ where: { paymentId: paymentId! } }))).toBe(1);
  });
});

describe('failed payments, retries and grace (K7)', () => {
  it('never reopens a cancelled subscription', async () => {
    const subscriptionId = await subscribe(await recurringPackage());
    await coach((tx) => confirmCheckout(tx, w.coach, { subscriptionId }, NOW));
    await coach((tx) => cancelSubscription(tx, w.coach, subscriptionId, NOW));
    expect(
      await codeOf(coach((tx) => handleFailedPayment(tx, w.coach, { subscriptionId }, NOW))),
    ).toBe('CONFLICT');
    const sub = await sys((tx) =>
      tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }),
    );
    expect(sub.status).toBe('cancelled');
  });

  it('retries only when due, restores the subscription, and pauses once grace runs out', async () => {
    const subscriptionId = await subscribe(await recurringPackage());
    await coach((tx) => confirmCheckout(tx, w.coach, { subscriptionId }, NOW));
    await coach((tx) => handleFailedPayment(tx, w.coach, { subscriptionId, graceDays: 3 }, NOW));
    const retry = (at: Date) =>
      runAs(prisma, w.coach, (tx) =>
        retryDueSubscription(tx, w.orgId, subscriptionId, undefined, at),
      );
    expect(await retry(later(DAY / 2))).toBeNull(); // first retry is 1 day after the failure
    expect(await retry(later(DAY + 60_000))).toEqual({ status: 'active' });
    expect(await retry(later(DAY + 120_000))).toBeNull(); // active: nothing to retry

    // Fails again with a 1-day grace: access stays on during grace, pauses after it.
    const failedAt = later(2 * DAY);
    await coach((tx) =>
      handleFailedPayment(tx, w.coach, { subscriptionId, graceDays: 1 }, failedAt),
    );
    const pausedAt = (ms: number) =>
      runAs(prisma, w.coach, (tx) =>
        clientBillingPaused(tx, w.clientId, new Date(failedAt.getTime() + ms)),
      );
    expect(await pausedAt(DAY / 2)).toBe(false);
    expect(
      await runAs(prisma, w.coach, (tx) =>
        expireGraces(tx, new Date(failedAt.getTime() + 2 * DAY)),
      ),
    ).toEqual({ paused: 1 });
    const sub = await sys((tx) =>
      tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }),
    );
    expect(sub.status).toBe('paused');
    expect(sub.needsReview).toBe(true);
  });

  it('pauses portal access only when no subscription still gives access', async () => {
    // This client also has the earlier test's active trial and its paused subscription: still not paused.
    expect(
      await runAs(prisma, w.coach, (tx) => clientBillingPaused(tx, w.clientId, later(5 * DAY))),
    ).toBe(false);
    const other = await newClientWorld(prisma, { orgId: w.orgId, coach: w.coach });
    expect(await runAs(prisma, w.coach, (tx) => clientBillingPaused(tx, other.clientId, NOW))).toBe(
      false,
    );
    await sys((tx) =>
      tx.subscription.updateMany({
        where: { clientId: w.clientId, status: { notIn: ['paused', 'cancelled'] } },
        data: { status: 'paused' },
      }),
    );
    expect(await runAs(prisma, w.coach, (tx) => clientBillingPaused(tx, w.clientId, NOW))).toBe(
      true,
    );
  });
});
