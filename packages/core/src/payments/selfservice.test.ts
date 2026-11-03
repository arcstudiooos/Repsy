import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { connectPaymentAccount, createCoupon, savePackage, updatePaymentSettings } from './catalog';
import {
  FAKE_SIGNATURE_HEADER,
  FakePayments,
  fakeCheckoutPaidEvents,
  fakeWebhookBody,
  signFakeWebhook,
} from './fake';
import type { PaymentEvent } from './port';
import { applyWebhook, recordManualPayment, startCheckout } from './purchases';
import {
  billingManageUrl,
  expireStalePurchases,
  getRevenue,
  liftPaymentGate,
  paymentGateFor,
  revenueCsv,
} from './selfservice';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const SECRET = 'test-fake-secret';
const fake = new FakePayments(SECRET, 'http://localhost:3000');
const portFor = () => fake;
const NOW = new Date('2026-11-04T15:00:00Z');
const DAY = 86_400_000;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

let n = 0;
/** A workspace with a public page, USD, a fake account and a live monthly subscription for one client. */
async function subscribed() {
  const org = await newOrg(prisma);
  const slug = `self-${Date.now().toString(36)}-${n++}`;
  await withSystem(
    (tx) =>
      tx.organization.update({
        where: { id: org.orgId },
        data: { publicSlug: slug, publicPageEnabled: true, paymentGraceDays: 3 },
      }),
    prisma,
  );
  const account = `acct_fake_${slug}`;
  await runAs(prisma, org.coach, async (tx) => {
    await updatePaymentSettings(tx, org.coach, { currency: 'USD' });
    await connectPaymentAccount(tx, org.coach, { provider: 'fake', accountRef: account });
  });
  const pkg = await runAs(prisma, org.coach, (tx) =>
    savePackage(tx, org.coach, {
      title: 'Monthly',
      kind: 'recurring',
      amountMinor: 12000,
      intervalUnit: 'month',
      intervalCount: 1,
      public: true,
    }),
  );
  const c = await startCheckout(
    prisma,
    slug,
    { packageId: pkg.id, name: 'Rae', email: `rae-${n}@example.test` },
    {
      portFor,
      successUrl: 'http://localhost:3000/t',
      cancelUrl: 'http://localhost:3000/c',
      now: NOW,
    },
  );
  const events = fakeCheckoutPaidEvents({
    checkoutRef: c.checkoutRef,
    purchaseId: c.purchaseId,
    amountMinor: 12000,
    currency: 'USD',
    mode: 'subscription',
    trialDays: 0,
    interval: { unit: 'month', count: 1 },
    now: NOW,
  });
  const body = fakeWebhookBody(account, events);
  await applyWebhook(
    prisma,
    'fake',
    fake.parseWebhook(
      body,
      new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body) }),
    ),
    NOW,
  );
  const p = await withSystem(
    (tx) => tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
    prisma,
  );
  const client: ActorContext = {
    userId: org.coach.userId,
    orgId: org.orgId,
    role: 'client',
    isPlatformAdmin: false,
    clientId: p.clientId!,
  };
  return { org, account, purchase: p, client, pkgId: pkg.id };
}

const fail = (subscriptionRef: string, id: string, at: Date): PaymentEvent => ({
  type: 'payment_failed',
  eventId: `evt_${id}`,
  paymentRef: `pay_${id}`,
  checkoutRef: null,
  subscriptionRef,
  amountMinor: 12000,
  currency: 'USD',
  failureCode: 'card_declined',
  at,
});

describe('payment gate (K7, D-013 #7)', () => {
  it('gates the portal only after the grace period, until lifted or paid; a new failure gates again', async () => {
    const s = await subscribed();
    const sub = s.purchase.subscriptionRef!;
    expect(await runAs(prisma, s.client, (tx) => paymentGateFor(tx, s.client, NOW))).toBeNull();

    await applyWebhook(
      prisma,
      'fake',
      { accountRef: s.account, events: [fail(sub, 'f1', NOW)] },
      NOW,
    );
    const day2 = new Date(NOW.getTime() + 2 * DAY);
    const day4 = new Date(NOW.getTime() + 4 * DAY);
    expect(await runAs(prisma, s.client, (tx) => paymentGateFor(tx, s.client, day2))).toBeNull();
    expect(await runAs(prisma, s.client, (tx) => paymentGateFor(tx, s.client, day4))).toMatchObject(
      { purchaseId: s.purchase.id, packageTitle: 'Monthly' },
    );
    // Staff are never gated.
    expect(
      await runAs(prisma, s.org.coach, (tx) => paymentGateFor(tx, s.org.coach, day4)),
    ).toBeNull();

    // A client can't lift it; the coach can.
    expect(
      await code(runAs(prisma, s.client, (tx) => liftPaymentGate(tx, s.client, s.purchase.id))),
    ).toBe('FORBIDDEN');
    await runAs(prisma, s.org.coach, (tx) =>
      liftPaymentGate(tx, s.org.coach, s.purchase.id, { now: day4 }),
    );
    expect(await runAs(prisma, s.client, (tx) => paymentGateFor(tx, s.client, day4))).toBeNull();

    // Paid, then failed again: a fresh grace period, then gated again despite the earlier lift.
    const day5 = new Date(NOW.getTime() + 5 * DAY);
    await applyWebhook(
      prisma,
      'fake',
      {
        accountRef: s.account,
        events: [
          {
            type: 'payment_succeeded',
            eventId: 'evt_ok_r',
            paymentRef: 'pay_ok_r',
            checkoutRef: null,
            subscriptionRef: sub,
            amountMinor: 12000,
            taxMinor: 0,
            currency: 'USD',
            method: 'card',
            paidAt: day5,
            periodEnd: new Date(day5.getTime() + 30 * DAY),
          },
        ],
      },
      day5,
    );
    const day40 = new Date(NOW.getTime() + 40 * DAY);
    await applyWebhook(
      prisma,
      'fake',
      { accountRef: s.account, events: [fail(sub, 'f2', day40)] },
      day40,
    );
    const day44 = new Date(NOW.getTime() + 44 * DAY);
    expect(
      await runAs(prisma, s.client, (tx) => paymentGateFor(tx, s.client, day44)),
    ).not.toBeNull();
  });
});

describe('self-service and revenue (K8, K9)', () => {
  it('links the client to the provider page for their own purchase only', async () => {
    const s = await subscribed();
    const other = await subscribed();
    const deps = {
      portFor,
      openAccount: (r: { provider: string; accountRef: string }) => ({
        provider: r.provider as 'fake',
        accountRef: r.accountRef,
      }),
      returnUrl: 'http://localhost:3000/portal/billing',
    };
    const url = await runAs(prisma, s.client, (tx) =>
      billingManageUrl(tx, s.client, s.purchase.id, deps),
    );
    expect(url).toBe('http://localhost:3000/portal/billing');
    // Another workspace's purchase id is invisible under RLS.
    expect(
      await code(
        runAs(prisma, s.client, (tx) => billingManageUrl(tx, s.client, other.purchase.id, deps)),
      ),
    ).toBe('NOT_FOUND');
  });

  it('reports MRR, subscriptions, churn and client value; manual payments count; CSV in major units', async () => {
    const s = await subscribed();
    const oneOff = await runAs(prisma, s.org.coach, (tx) =>
      savePackage(tx, s.org.coach, { title: 'Assessment', kind: 'one_off', amountMinor: 3000 }),
    );
    await runAs(prisma, s.org.coach, (tx) =>
      recordManualPayment(
        tx,
        s.org.coach,
        {
          clientId: s.client.clientId!,
          packageId: oneOff.id,
          method: 'cash',
          paidAt: NOW.toISOString(),
        },
        { now: NOW },
      ),
    );
    const r = await runAs(prisma, s.org.coach, (tx) => getRevenue(tx, s.org.coach, NOW));
    expect(r).toMatchObject({
      currency: 'USD',
      mrrMinor: 12000,
      activeSubscriptions: 1,
      averageClientValueMinor: 15000,
    });
    expect(r.monthly.at(-1)).toMatchObject({ month: '2026-11', grossMinor: 15000, payments: 2 });
    expect(revenueCsv(r, 2).trimEnd().split('\r\n').at(-1)).toBe(
      '2026-11,USD,2,150.00,0.00,150.00',
    );
    expect(await code(runAs(prisma, s.client, (tx) => getRevenue(tx, s.client, NOW)))).toBe(
      'FORBIDDEN',
    );
  });

  it('expires checkouts left unpaid for a day, and a late payment still activates them', async () => {
    const org = await newOrg(prisma);
    const slug = `exp-${Date.now().toString(36)}`;
    await withSystem(
      (tx) =>
        tx.organization.update({
          where: { id: org.orgId },
          data: { publicSlug: slug, publicPageEnabled: true },
        }),
      prisma,
    );
    const account = `acct_fake_${slug}`;
    await runAs(prisma, org.coach, async (tx) => {
      await updatePaymentSettings(tx, org.coach, { currency: 'USD' });
      await connectPaymentAccount(tx, org.coach, { provider: 'fake', accountRef: account });
    });
    const pkg = await runAs(prisma, org.coach, (tx) =>
      savePackage(tx, org.coach, {
        title: 'One',
        kind: 'one_off',
        amountMinor: 1000,
        public: true,
      }),
    );
    await runAs(prisma, org.coach, (tx) =>
      createCoupon(
        tx,
        org.coach,
        { code: 'ONCE', kind: 'percent', value: 50, maxUses: 1 },
        { now: NOW },
      ),
    );
    const c = await startCheckout(
      prisma,
      slug,
      { packageId: pkg.id, name: 'Lee', email: 'lee@example.test', coupon: 'once' },
      {
        portFor,
        successUrl: 'http://localhost:3000/t',
        cancelUrl: 'http://localhost:3000/c',
        now: NOW,
      },
    );
    // The single use is reserved at checkout: a second open checkout can't spend it too.
    const again = { packageId: pkg.id, name: 'Kim', email: 'kim@example.test', coupon: 'ONCE' };
    const urls = {
      portFor,
      successUrl: 'http://localhost:3000/t',
      cancelUrl: 'http://localhost:3000/c',
      now: NOW,
    };
    expect(await code(startCheckout(prisma, slug, again, urls))).toBe('VALIDATION');
    const later = new Date(NOW.getTime() + 2 * DAY);
    const expired = await withSystem((tx) => expireStalePurchases(tx, later), prisma);
    expect(expired).toBeGreaterThanOrEqual(1);
    const uses = () =>
      withSystem(
        (tx) => tx.coupon.findFirstOrThrow({ where: { organizationId: org.orgId } }),
        prisma,
      );
    expect((await uses()).uses).toBe(0);
    const events = fakeCheckoutPaidEvents({
      checkoutRef: c.checkoutRef,
      purchaseId: c.purchaseId,
      amountMinor: 500,
      currency: 'USD',
      mode: 'payment',
      trialDays: 0,
      now: later,
    });
    const body = fakeWebhookBody(account, events);
    await applyWebhook(
      prisma,
      'fake',
      fake.parseWebhook(
        body,
        new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body) }),
      ),
      later,
    );
    const p = await withSystem(
      (tx) => tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
      prisma,
    );
    expect(p.status).toBe('active');
    expect((await uses()).uses).toBe(1);
  });
});
