import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { evaluateRules } from '../review/rules';
import { newClientWorld, newOrg, runAs, type Org } from '../sessions/fixtures.test-helpers';
import { connectPaymentAccount, createCoupon, savePackage, updatePaymentSettings } from './catalog';
import {
  FAKE_SIGNATURE_HEADER,
  FakePayments,
  fakeCheckoutPaidEvents,
  fakeWebhookBody,
  signFakeWebhook,
} from './fake';
import {
  addInterval,
  discounted,
  formatMoney,
  minorDigits,
  monthlyValue,
  parseMoney,
} from './money';
import type { PaymentEvent, WebhookBatch } from './port';
import {
  applyWebhook,
  cancelPurchase,
  getReceipt,
  getStorefront,
  listPayments,
  listPurchases,
  recordManualPayment,
  refundPayment,
  startCheckout,
  voidManualPayment,
} from './purchases';

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

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

let slugN = 0;
/** A workspace with an enabled public page, a currency and a connected fake account. */
async function shop(
  opts: { currency?: string } = {},
): Promise<Org & { slug: string; account: string }> {
  const org = await newOrg(prisma);
  const slug = `shop-${Date.now().toString(36)}-${slugN++}`;
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
    await updatePaymentSettings(tx, org.coach, { currency: opts.currency ?? 'USD' });
    await connectPaymentAccount(tx, org.coach, { provider: 'fake', accountRef: account });
  });
  return { ...org, slug, account };
}

const deps = {
  portFor,
  successUrl: 'http://localhost:3000/join/x/thanks?purchase={purchase}',
  cancelUrl: 'http://localhost:3000/join/x',
  now: NOW,
};

/** Simulates the provider: the paid checkout's events as one signed, parsed webhook batch. */
function paidBatch(
  account: string,
  checkoutRef: string,
  purchaseId: string,
  over: Partial<Parameters<typeof fakeCheckoutPaidEvents>[0]> = {},
): WebhookBatch {
  const events = fakeCheckoutPaidEvents({
    checkoutRef,
    purchaseId,
    amountMinor: 5000,
    currency: 'USD',
    mode: 'payment',
    trialDays: 0,
    now: NOW,
    ...over,
  });
  const body = fakeWebhookBody(account, events);
  return fake.parseWebhook(
    body,
    new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body) }),
  );
}

describe('money (D-013 #2)', () => {
  it('handles minor units, coupons, MRR and intervals', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(parseMoney('49.5', 'USD')).toBe(4950);
    expect(parseMoney('1,299.00', 'USD')).toBe(129900);
    expect(parseMoney('4.999', 'USD')).toBeNull();
    expect(parseMoney('500', 'JPY')).toBe(500);
    expect(parseMoney('5.5', 'JPY')).toBeNull();
    expect(discounted(10000, { kind: 'percent', value: 15 })).toBe(8500);
    expect(discounted(1000, { kind: 'fixed', value: 5000 })).toBe(0);
    expect(monthlyValue(1000, 'week', 1)).toBe(4333);
    expect(monthlyValue(30000, 'month', 3)).toBe(10000);
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'month', 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(formatMoney(129900, 'INR', 'en-IN')).toContain('1,299');
  });
});

describe('settings and packages (K3)', () => {
  it('sets the currency once and validates packages', async () => {
    const org = await newOrg(prisma);
    expect(
      await code(runAs(prisma, org.coach, (tx) => savePackage(tx, org.coach, { title: 'X' }))),
    ).toBe('CONFLICT');
    await runAs(prisma, org.coach, (tx) =>
      updatePaymentSettings(tx, org.coach, { currency: 'inr' }),
    );
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => updatePaymentSettings(tx, org.coach, { currency: 'USD' })),
      ),
    ).toBe('CONFLICT');
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => updatePaymentSettings(tx, org.coach, { currency: 'ZZZ' })),
      ),
    ).toBe('VALIDATION');
    const bad = [
      { title: 'T', kind: 'one_off', amountMinor: 100, trialDays: 7 },
      { title: 'T', kind: 'plan', amountMinor: 100, intervalUnit: 'month' },
      { title: 'T', kind: 'recurring', amountMinor: 0, intervalUnit: 'month' },
      { title: 'T', kind: 'recurring', amountMinor: 100, intervalUnit: 'day' },
    ];
    for (const input of bad) {
      expect(await code(runAs(prisma, org.coach, (tx) => savePackage(tx, org.coach, input)))).toBe(
        'VALIDATION',
      );
    }
    const pkg = await runAs(prisma, org.coach, (tx) =>
      savePackage(tx, org.coach, {
        title: '12-week plan',
        kind: 'plan',
        amountMinor: 10000,
        intervalUnit: 'month',
        intervalCount: 1,
        installments: 3,
      }),
    );
    expect(pkg).toMatchObject({ kind: 'plan', installments: 3, intervalCount: 1, public: false });
    // A coach (not a manager) can't edit packages.
    const coach: ActorContext = { ...org.coach, role: 'coach' };
    expect(await code(runAs(prisma, coach, (tx) => savePackage(tx, coach, { title: 'x' })))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('storefront checkout and webhooks (K4, D-013 #3-#5)', () => {
  it('a paid checkout creates and invites the client, tags them, numbers the receipt and counts the coupon; replays do nothing', async () => {
    const s = await shop();
    const tag = await withSystem(
      (tx) =>
        tx.clientTag.create({ data: { organizationId: s.orgId, name: 'Paid', color: 'teal' } }),
      prisma,
    );
    const pkg = await runAs(prisma, s.coach, (tx) =>
      savePackage(tx, s.coach, {
        title: 'Kickstart',
        kind: 'one_off',
        amountMinor: 5000,
        accessDays: 30,
        public: true,
        tagId: tag.id,
      }),
    );
    await runAs(prisma, s.coach, (tx) =>
      createCoupon(
        tx,
        s.coach,
        { code: 'welcome10', kind: 'percent', value: 10, maxUses: 1 },
        { now: NOW },
      ),
    );
    const store = await getStorefront(prisma, s.slug);
    expect(store?.packages.map((p) => p.title)).toEqual(['Kickstart']);

    const checkout = await startCheckout(
      prisma,
      s.slug,
      { packageId: pkg.id, name: 'Ana Buyer', email: 'Ana@Example.test', coupon: 'WELCOME10' },
      deps,
    );
    expect(checkout.url).toContain('/dev/checkout/');
    const batch = paidBatch(s.account, checkout.checkoutRef, checkout.purchaseId, {
      amountMinor: 4500,
    });
    const first = await applyWebhook(prisma, 'fake', batch, NOW);
    expect(first).toMatchObject({ orgId: s.orgId, applied: 2 });
    const replay = await applyWebhook(prisma, 'fake', batch, NOW);
    expect(replay.applied).toBe(0);

    const state = await withSystem(async (tx) => {
      const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: checkout.purchaseId } });
      const client = await tx.client.findFirstOrThrow({
        where: { organizationId: s.orgId, email: 'ana@example.test' },
      });
      return {
        purchase,
        client,
        payments: await tx.payment.findMany({ where: { purchaseId: purchase.id } }),
        invites: await tx.clientInvite.count({ where: { clientId: client.id } }),
        tags: await tx.clientTagLink.count({ where: { clientId: client.id, tagId: tag.id } }),
        events: await tx.clientEvent.count({
          where: { clientId: client.id, kind: 'package_purchased' },
        }),
        coupon: await tx.coupon.findFirstOrThrow({ where: { organizationId: s.orgId } }),
        receiptEmails: await tx.outboxEmail.count({
          where: { templateKey: 'payment_receipt', organizationId: s.orgId },
        }),
      };
    }, prisma);
    expect(state.purchase).toMatchObject({
      status: 'active',
      firstChargeMinor: 4500,
      installmentsPaid: 1,
    });
    expect(state.purchase.accessEndsAt?.toISOString()).toBe('2026-12-04T15:00:00.000Z');
    expect(state.client.status).toBe('invited');
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      status: 'succeeded',
      amountMinor: 4500,
      receiptNo: 1,
    });
    expect(state).toMatchObject({ invites: 1, tags: 1, events: 1, receiptEmails: 1 });
    expect(state.coupon).toMatchObject({ uses: 1 });

    // The coupon is used up now.
    expect(
      await code(
        startCheckout(
          prisma,
          s.slug,
          { packageId: pkg.id, name: 'B', email: 'b@example.test', coupon: 'WELCOME10' },
          deps,
        ),
      ),
    ).toBe('VALIDATION');
  });

  it('a subscription with a trial, a failed charge (review item, email, past due) and the next success', async () => {
    const s = await shop();
    const pkg = await runAs(prisma, s.coach, (tx) =>
      savePackage(tx, s.coach, {
        title: 'Monthly coaching',
        kind: 'recurring',
        amountMinor: 9900,
        intervalUnit: 'month',
        intervalCount: 1,
        trialDays: 7,
        public: true,
      }),
    );
    const c = await startCheckout(
      prisma,
      s.slug,
      { packageId: pkg.id, name: 'Sam', email: 'sam@example.test' },
      deps,
    );
    expect(fake.calls.at(-1)?.args[0]).toMatchObject({
      mode: 'subscription',
      trialDays: 7,
      recurringMinor: 9900,
    });
    await applyWebhook(
      prisma,
      'fake',
      paidBatch(s.account, c.checkoutRef, c.purchaseId, {
        mode: 'subscription',
        trialDays: 7,
        interval: { unit: 'month', count: 1 },
      }),
      NOW,
    );
    const sub = await withSystem(
      (tx) => tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
      prisma,
    );
    expect(sub.status).toBe('trialing');
    expect(sub.subscriptionRef).toMatch(/^sub_fake_/);

    const failed: PaymentEvent = {
      type: 'payment_failed',
      eventId: 'evt_fail_1',
      paymentRef: 'pay_fail_1',
      checkoutRef: null,
      subscriptionRef: sub.subscriptionRef,
      amountMinor: 9900,
      currency: 'USD',
      failureCode: 'card_declined',
      at: NOW,
    };
    await applyWebhook(prisma, 'fake', { accountRef: s.account, events: [failed] }, NOW);
    const after = await withSystem(
      async (tx) => ({
        purchase: await tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
        flags: await tx.reviewFlag.findMany({
          where: { ruleKey: 'payment_failed', organizationId: s.orgId },
        }),
        emails: await tx.outboxEmail.count({
          where: { templateKey: 'payment_failed', organizationId: s.orgId },
        }),
      }),
      prisma,
    );
    expect(after.purchase.status).toBe('past_due');
    expect(after.flags.map((f) => f.state)).toEqual(['open']);
    expect(after.emails).toBe(1);

    const paid: PaymentEvent = {
      type: 'payment_succeeded',
      eventId: 'evt_ok_2',
      paymentRef: 'pay_ok_2',
      checkoutRef: null,
      subscriptionRef: sub.subscriptionRef,
      amountMinor: 9900,
      taxMinor: 0,
      currency: 'USD',
      method: 'card',
      paidAt: NOW,
      periodEnd: addInterval(NOW, 'month', 1),
    };
    await applyWebhook(prisma, 'fake', { accountRef: s.account, events: [paid] }, NOW);
    const healed = await withSystem(
      async (tx) => ({
        purchase: await tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
        flag: await tx.reviewFlag.findFirstOrThrow({
          where: { ruleKey: 'payment_failed', organizationId: s.orgId },
        }),
      }),
      prisma,
    );
    expect(healed.purchase).toMatchObject({ status: 'active', pastDueSince: null });
    expect(healed.flag.state).toBe('resolved');
  });

  it("a plan's last instalment asks the caller to cancel the subscription", async () => {
    const s = await shop();
    const pkg = await runAs(prisma, s.coach, (tx) =>
      savePackage(tx, s.coach, {
        title: 'Plan',
        kind: 'plan',
        amountMinor: 3000,
        intervalUnit: 'month',
        installments: 2,
        public: true,
      }),
    );
    const c = await startCheckout(
      prisma,
      s.slug,
      { packageId: pkg.id, name: 'P', email: 'p@example.test' },
      deps,
    );
    const first = await applyWebhook(
      prisma,
      'fake',
      paidBatch(s.account, c.checkoutRef, c.purchaseId, {
        mode: 'subscription',
        interval: { unit: 'month', count: 1 },
        amountMinor: 3000,
      }),
      NOW,
    );
    expect(first.cancelSubscriptions).toEqual([]);
    const subRef = (
      await withSystem(
        (tx) => tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
        prisma,
      )
    ).subscriptionRef!;
    const second = await applyWebhook(
      prisma,
      'fake',
      {
        accountRef: s.account,
        events: [
          {
            type: 'payment_succeeded',
            eventId: 'evt_plan_2',
            paymentRef: 'pay_plan_2',
            checkoutRef: null,
            subscriptionRef: subRef,
            amountMinor: 3000,
            taxMinor: 0,
            currency: 'USD',
            method: 'card',
            paidAt: NOW,
            periodEnd: null,
          },
        ],
      },
      NOW,
    );
    expect(second.cancelSubscriptions).toEqual([subRef]);
  });

  it('refuses forged webhooks, ignores unknown accounts and never crosses workspaces', async () => {
    const a = await shop();
    const b = await shop();
    const pkgA = await runAs(prisma, a.coach, (tx) =>
      savePackage(tx, a.coach, { title: 'A', kind: 'one_off', amountMinor: 1000, public: true }),
    );
    const ca = await startCheckout(
      prisma,
      a.slug,
      { packageId: pkgA.id, name: 'X', email: 'x@example.test' },
      deps,
    );
    const body = fakeWebhookBody(a.account, []);
    expect(() => fake.parseWebhook(body, new Headers({ [FAKE_SIGNATURE_HEADER]: 'nope' }))).toThrow(
      /signature/,
    );
    expect(
      (await applyWebhook(prisma, 'fake', { accountRef: 'acct_unknown', events: [] }, NOW)).orgId,
    ).toBeNull();
    // B's account names A's purchase: applied in B's scope, it finds nothing.
    const cross = await applyWebhook(
      prisma,
      'fake',
      paidBatch(b.account, ca.checkoutRef, ca.purchaseId),
      NOW,
    );
    expect(cross.orgId).toBe(b.orgId);
    const p = await withSystem(
      (tx) => tx.purchase.findUniqueOrThrow({ where: { id: ca.purchaseId } }),
      prisma,
    );
    expect(p.status).toBe('pending');
  });

  it('refuses checkout when the workspace is at its client limit', async () => {
    const s = await shop();
    await withSystem(
      (tx) => tx.organization.update({ where: { id: s.orgId }, data: { activeClientLimit: 0 } }),
      prisma,
    );
    const pkg = await runAs(prisma, s.coach, (tx) =>
      savePackage(tx, s.coach, { title: 'Full', kind: 'one_off', amountMinor: 1000, public: true }),
    );
    expect(
      await code(
        startCheckout(
          prisma,
          s.slug,
          { packageId: pkg.id, name: 'N', email: 'n@example.test' },
          deps,
        ),
      ),
    ).toBe('CONFLICT');
  });
});

describe('manual payments, cancel, refunds and receipts (K6, K8, K15)', () => {
  it('records manual payments with gap-free receipts; void needs a reason; the GST split follows the region', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, org.coach, (tx) =>
      updatePaymentSettings(tx, org.coach, {
        currency: 'INR',
        taxId: '27ABCDE1234F1Z5',
        taxRateBp: 1800,
        taxHomeRegion: 'Maharashtra',
      }),
    );
    const pkg = await runAs(prisma, org.coach, (tx) =>
      savePackage(tx, org.coach, {
        title: 'Monthly',
        kind: 'recurring',
        amountMinor: 118000,
        intervalUnit: 'month',
      }),
    );
    const one = await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, packageId: pkg.id, method: 'bank', note: 'NEFT ref 123' },
        { now: NOW },
      ),
    );
    const two = await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, purchaseId: one.purchaseId, method: 'cash' },
        { now: NOW },
      ),
    );
    expect([one.receiptNo, two.receiptNo]).toEqual([1, 2]);
    const purchase = (
      await runAs(prisma, org.coach, (tx) => listPurchases(tx, org.coach, { clientId: w.clientId }))
    )[0]!;
    expect(purchase).toMatchObject({ provider: 'manual', status: 'active', installmentsPaid: 2 });
    expect(purchase.currentPeriodEnd).toBe('2027-01-04T15:00:00.000Z');

    const receipt = await runAs(prisma, w.client, (tx) => getReceipt(tx, w.client, one.paymentId));
    // No buyer region on a manual purchase: shown as IGST, included in the price.
    expect(receipt.taxLines).toEqual([{ label: 'IGST 18% (included)', amountMinor: 18000 }]);
    expect(receipt).toMatchObject({ receiptNo: 1, taxId: '27ABCDE1234F1Z5', amountMinor: 118000 });
    await withSystem(
      (tx) =>
        tx.purchase.update({
          where: { id: one.purchaseId },
          data: { buyerRegion: 'maharashtra ' },
        }),
      prisma,
    );
    const split = await runAs(prisma, org.coach, (tx) => getReceipt(tx, org.coach, one.paymentId));
    expect(split.taxLines).toEqual([
      { label: 'CGST 9% (included)', amountMinor: 9000 },
      { label: 'SGST 9% (included)', amountMinor: 9000 },
    ]);

    // Another client can't read it.
    const other = await newClientWorld(prisma, org);
    expect(
      await code(runAs(prisma, other.client, (tx) => getReceipt(tx, other.client, one.paymentId))),
    ).toBe('NOT_FOUND');
    expect(await runAs(prisma, other.client, (tx) => listPayments(tx, other.client))).toEqual([]);

    expect(
      await code(
        runAs(prisma, org.coach, (tx) => voidManualPayment(tx, org.coach, two.paymentId, ' ')),
      ),
    ).toBe('VALIDATION');
    await runAs(prisma, org.coach, (tx) =>
      voidManualPayment(tx, org.coach, two.paymentId, 'Entered twice'),
    );
    const pays = await runAs(prisma, org.coach, (tx) =>
      listPayments(tx, org.coach, { clientId: w.clientId }),
    );
    expect(pays.map((p) => p.status).sort()).toEqual(['succeeded', 'void']);
    // An assistant can't record payments.
    const assistant: ActorContext = { ...org.coach, role: 'assistant' };
    expect(
      await code(
        runAs(prisma, assistant, (tx) =>
          recordManualPayment(tx, assistant, {
            clientId: w.clientId,
            packageId: pkg.id,
            method: 'cash',
          }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('a client cancels their own subscription at the period end; another client cannot; a manager refunds', async () => {
    const s = await shop();
    const pkg = await runAs(prisma, s.coach, (tx) =>
      savePackage(tx, s.coach, {
        title: 'Sub',
        kind: 'recurring',
        amountMinor: 2000,
        intervalUnit: 'week',
        public: true,
      }),
    );
    const w = await newClientWorld(prisma, s);
    const email = (
      await withSystem((tx) => tx.client.findUniqueOrThrow({ where: { id: w.clientId } }), prisma)
    ).email;
    const c = await startCheckout(
      prisma,
      s.slug,
      { packageId: pkg.id, name: 'Client', email },
      deps,
    );
    await applyWebhook(
      prisma,
      'fake',
      paidBatch(s.account, c.checkoutRef, c.purchaseId, {
        mode: 'subscription',
        interval: { unit: 'week', count: 1 },
        amountMinor: 2000,
      }),
      NOW,
    );
    const linked = await withSystem(
      (tx) => tx.purchase.findUniqueOrThrow({ where: { id: c.purchaseId } }),
      prisma,
    );
    expect(linked.clientId).toBe(w.clientId);

    const other = await newClientWorld(prisma, s);
    expect(
      await code(
        runAs(prisma, other.client, (tx) =>
          cancelPurchase(tx, other.client, c.purchaseId, {}, { portFor, now: NOW }),
        ),
      ),
    ).toBe('NOT_FOUND');
    const res = await runAs(prisma, w.client, (tx) =>
      cancelPurchase(tx, w.client, c.purchaseId, { now: true }, { portFor, now: NOW }),
    );
    expect(res).toEqual({ status: 'canceled', endsAt: '2026-11-11T15:00:00.000Z' });
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'cancelSubscription',
      args: [expect.anything(), linked.subscriptionRef, true],
    });

    const pay = (
      await runAs(prisma, s.coach, (tx) => listPayments(tx, s.coach, { clientId: w.clientId }))
    )[0]!;
    expect(
      await code(
        runAs(prisma, s.coach, (tx) =>
          refundPayment(tx, s.coach, pay.id, { amountMinor: 999999 }, { portFor }),
        ),
      ),
    ).toBe('VALIDATION');
    const r = await runAs(prisma, s.coach, (tx) =>
      refundPayment(tx, s.coach, pay.id, { amountMinor: 500 }, { portFor }),
    );
    expect(r.refundedMinor).toBe(500);
  });

  it('raises "Ready to assign" once the buyer is active, and settles it once the template is assigned', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, org.coach, (tx) =>
      updatePaymentSettings(tx, org.coach, { currency: 'USD' }),
    );
    const pkg = await runAs(prisma, org.coach, (tx) =>
      savePackage(tx, org.coach, {
        title: 'With plan',
        kind: 'one_off',
        amountMinor: 1000,
        templateProgramId: w.templateId,
      }),
    );
    await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, packageId: pkg.id, method: 'cash' },
        { now: NOW },
      ),
    );
    await withTenantRules(org.orgId, NOW);
    const flags = await withSystem(
      (tx) =>
        tx.reviewFlag.findMany({
          where: { organizationId: org.orgId, ruleKey: 'ready_to_assign' },
        }),
      prisma,
    );
    expect(flags).toHaveLength(1);
    // Assigning that template (a new assignment after the flag) settles it.
    const { assignProgram } = await import('../assignments/assign');
    await runAs(prisma, org.coach, (tx) =>
      assignProgram(
        tx,
        org.coach,
        {
          clientId: w.clientId,
          templateProgramId: w.templateId,
          startLocalDate: '2026-11-09',
          weekdays: [1, 3, 5],
          readinessConfirmed: true,
          confirmReplace: true,
        },
        { now: NOW },
      ),
    );
    await withTenantRules(org.orgId, NOW);
    const after = await withSystem(
      (tx) => tx.reviewFlag.findFirstOrThrow({ where: { id: flags[0]!.id } }),
      prisma,
    );
    expect(after.state).toBe('resolved');
  });
});

async function withTenantRules(orgId: string, now: Date) {
  const { withTenant } = await import('@kinetic/db');
  await withTenant(orgId, (tx) => evaluateRules(tx, orgId, now), prisma);
}
