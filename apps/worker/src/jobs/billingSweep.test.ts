import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { sweepBilling } from './billingSweep';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;
let packageId: string;

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  ({ orgId, packageId } = await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'coach@example.test', name: 'Coach' } });
    const org = await tx.organization.create({
      data: { name: 'Org', timezone: 'UTC', ownerUserId: user.id },
    });
    const pkg = await tx.billingPackage.create({
      data: {
        organizationId: org.id,
        title: 'Monthly',
        kind: 'recurring',
        interval: 'month',
        amountMinor: 10000,
        currency: 'USD',
      },
    });
    return { orgId: org.id, packageId: pkg.id };
  }, prisma));
});
afterAll(async () => {
  await drop();
});

const subscription = (data: {
  status: string;
  nextRetryAt?: Date | null;
  nextChargeAt?: Date | null;
  graceEndsAt?: Date | null;
  needsReview?: boolean;
}) =>
  withSystem(
    async (tx) =>
      (
        await tx.subscription.create({
          data: {
            organizationId: orgId,
            packageId,
            customerEmail: 'buyer@example.test',
            provider: 'stripe',
            amountMinor: 10000,
            currency: 'USD',
            interval: 'month',
            failedAttempts: 1,
            ...data,
          },
        })
      ).id,
    prisma,
  );

const statusOf = (id: string) =>
  withSystem((tx) => tx.subscription.findUniqueOrThrow({ where: { id } }), prisma);

describe('sweepBilling (PRD K7)', () => {
  it('retries due subscriptions, leaves the rest, and pauses expired grace periods', async () => {
    const due = await subscription({
      status: 'past_due',
      nextRetryAt: new Date(NOW.getTime() - 1),
    });
    const notYet = await subscription({
      status: 'past_due',
      nextRetryAt: new Date(NOW.getTime() + DAY),
    });
    const review = await subscription({
      status: 'past_due',
      nextRetryAt: null,
      needsReview: true,
    });
    const renewal = await subscription({
      status: 'active',
      nextChargeAt: new Date(NOW.getTime() - 1),
    });
    const graceOver = await subscription({
      status: 'grace',
      nextRetryAt: new Date(NOW.getTime() + DAY),
      graceEndsAt: new Date(NOW.getTime() - 1),
    });

    expect(await sweepBilling(prisma, NOW)).toEqual({
      renewed: 1,
      retried: 1,
      paused: 1,
      failed: 0,
    });
    expect((await statusOf(due)).status).toBe('active');
    expect((await statusOf(notYet)).status).toBe('past_due');
    expect((await statusOf(review)).status).toBe('past_due');
    expect((await statusOf(graceOver)).status).toBe('paused');
    const renewed = await statusOf(renewal);
    expect(renewed.status).toBe('active');
    expect(renewed.nextChargeAt).toEqual(new Date('2026-12-04T12:00:00Z'));

    // A second run finds nothing left to do.
    expect(await sweepBilling(prisma, NOW)).toEqual({
      renewed: 0,
      retried: 0,
      paused: 0,
      failed: 0,
    });
  });
});
