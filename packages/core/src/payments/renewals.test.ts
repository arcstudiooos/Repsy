import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { processClientEvents } from '../automations/engine';
import { saveSequence } from '../automations/sequences';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { savePackage, updatePaymentSettings } from './catalog';
import { cancelPurchase, recordManualPayment } from './purchases';
import { sweepPackages } from './renewals';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-04T15:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

describe('package journeys (J4, J6, D-013 #13)', () => {
  it('notifies once per renewal date (email, event, review item) and starts the matching sequence only', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, org.coach, (tx) =>
      updatePaymentSettings(tx, org.coach, { currency: 'USD', renewalNoticeDays: 5 }),
    );
    const [monthly, other] = await runAs(prisma, org.coach, async (tx) => [
      await savePackage(tx, org.coach, {
        title: 'Monthly',
        kind: 'recurring',
        amountMinor: 10000,
        intervalUnit: 'month',
      }),
      await savePackage(tx, org.coach, { title: 'Other', kind: 'one_off', amountMinor: 500 }),
    ]);
    // A sequence narrowed to the monthly package, and one narrowed to another package.
    await runAs(prisma, org.coach, async (tx) => {
      for (const [name, pkg] of [
        ['Renewal chat', monthly!.id],
        ['Not this one', other!.id],
      ] as const) {
        await saveSequence(tx, org.coach, {
          name,
          trigger: 'package_renewal_due',
          triggerValue: pkg,
          steps: [
            { dayOffset: 0, localTime: '09:00', type: 'followup', config: { title: 'Renewal' } },
          ],
        });
      }
    });
    // Another workspace's package id is refused as a trigger value.
    const elsewhere = await newOrg(prisma);
    expect(
      await code(
        runAs(prisma, elsewhere.coach, (tx) =>
          saveSequence(tx, elsewhere.coach, {
            name: 'X',
            trigger: 'package_ended',
            triggerValue: monthly!.id,
            steps: [],
          }),
        ),
      ),
    ).toBe('VALIDATION');

    const { purchaseId } = await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, packageId: monthly!.id, method: 'cash' },
        { now: NOW },
      ),
    );
    // Renews on 4 Dec: nothing 10 days before, a notice 4 days before, once.
    expect(await sweepPackages(prisma, at(20))).toMatchObject({ notified: 0 });
    expect(await sweepPackages(prisma, at(26))).toMatchObject({ notified: 1 });
    expect(await sweepPackages(prisma, at(27))).toMatchObject({ notified: 0 });

    const state = await withSystem(
      async (tx) => ({
        events: await tx.clientEvent.findMany({
          where: { clientId: w.clientId, kind: 'package_renewal_due' },
        }),
        flags: await tx.reviewFlag.count({
          where: { clientId: w.clientId, ruleKey: 'package_renewal' },
        }),
        emails: await tx.outboxEmail.findMany({
          where: { organizationId: org.orgId, templateKey: 'package_renewal' },
        }),
      }),
      prisma,
    );
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.detailJson).toMatchObject({ purchaseId, ending: false });
    expect(state.flags).toBe(1);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0]?.payloadJson).toMatchObject({ title: 'Monthly', ending: false });

    await processClientEvents(prisma, at(26));
    const runs = await withSystem(
      (tx) =>
        tx.sequenceRun.findMany({
          where: { clientId: w.clientId },
          select: { sequence: { select: { name: true } } },
        }),
      prisma,
    );
    expect(runs.map((r) => r.sequence.name)).toEqual(['Renewal chat']);

    // Paid again: a new period, so a new notice before the next date.
    await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, purchaseId, method: 'cash' },
        { now: at(29) },
      ),
    );
    expect(await sweepPackages(prisma, at(57))).toMatchObject({ notified: 1 });
  });

  it('a cancelled manual subscription notices its end, then ends with package_ended; one-offs end with their access', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, org.coach, (tx) =>
      updatePaymentSettings(tx, org.coach, { currency: 'USD' }),
    );
    const [monthly, pass] = await runAs(prisma, org.coach, async (tx) => [
      await savePackage(tx, org.coach, {
        title: 'Monthly',
        kind: 'recurring',
        amountMinor: 10000,
        intervalUnit: 'month',
      }),
      await savePackage(tx, org.coach, {
        title: '30-day pass',
        kind: 'one_off',
        amountMinor: 3000,
        accessDays: 30,
      }),
    ]);
    const sub = await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, packageId: monthly!.id, method: 'cash' },
        { now: NOW },
      ),
    );
    await runAs(prisma, org.coach, (tx) =>
      recordManualPayment(
        tx,
        org.coach,
        { clientId: w.clientId, packageId: pass!.id, method: 'cash' },
        { now: NOW },
      ),
    );
    await runAs(prisma, org.coach, (tx) =>
      cancelPurchase(
        tx,
        org.coach,
        sub.purchaseId,
        {},
        {
          portFor: () => {
            throw new Error('no provider');
          },
          now: at(1),
        },
      ),
    );
    // Both end on 4 Dec: notices say "ends", then both end, each with one package_ended.
    expect(await sweepPackages(prisma, at(27))).toEqual({ notified: 2, ended: 0 });
    const emails = await withSystem(
      (tx) =>
        tx.outboxEmail.findMany({
          where: { organizationId: org.orgId, templateKey: 'package_renewal' },
        }),
      prisma,
    );
    expect(emails.map((e) => (e.payloadJson as { ending: boolean }).ending)).toEqual([true, true]);
    expect(await sweepPackages(prisma, at(31))).toEqual({ notified: 0, ended: 2 });
    expect(await sweepPackages(prisma, at(32))).toEqual({ notified: 0, ended: 0 });
    const ended = await withSystem(
      async (tx) => ({
        statuses: (
          await tx.purchase.findMany({ where: { clientId: w.clientId }, select: { status: true } })
        ).map((p) => p.status),
        events: await tx.clientEvent.count({
          where: { clientId: w.clientId, kind: 'package_ended' },
        }),
      }),
      prisma,
    );
    expect(ended).toEqual({ statuses: ['ended', 'ended'], events: 2 });
  });
});
