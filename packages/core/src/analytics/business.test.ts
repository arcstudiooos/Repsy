import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { updateClient } from '../clients/clients';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getBusinessAnalytics } from './business';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-15T12:00:00Z');

describe('business analytics (PRD I7)', () => {
  it('counts cohorts, lifetimes and why coaching ended', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const c = await newClientWorld(prisma, org);
    // a and b started in June; c in October.
    await withSystem(async (tx) => {
      await tx.client.update({
        where: { id: a.clientId },
        data: { consentAt: new Date('2026-06-10T00:00:00Z') },
      });
      await tx.client.update({
        where: { id: b.clientId },
        data: { consentAt: new Date('2026-06-20T00:00:00Z') },
      });
      await tx.client.update({
        where: { id: c.clientId },
        data: { consentAt: new Date('2026-10-05T00:00:00Z') },
      });
    }, prisma);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        updateClient(tx, org.coach, b.clientId, { status: 'archived', churnReason: 'nope' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await runAs(prisma, org.coach, (tx) =>
      updateClient(tx, org.coach, b.clientId, { status: 'archived', churnReason: 'cost' }),
    );
    // The trigger stamps the date; set it to August for the cohort maths.
    const stamped = await withSystem(
      (tx) =>
        tx.client.findUniqueOrThrow({
          where: { id: b.clientId },
          select: { archivedAt: true, churnReason: true },
        }),
      prisma,
    );
    expect(stamped).toMatchObject({ churnReason: 'cost' });
    expect(stamped.archivedAt).not.toBeNull();
    await withSystem(
      (tx) =>
        tx.client.update({
          where: { id: b.clientId },
          data: { archivedAt: new Date('2026-08-15T00:00:00Z') },
        }),
      prisma,
    );

    const r = await runAs(prisma, org.coach, (tx) => getBusinessAnalytics(tx, org.coach, NOW));
    expect(r.activeNow).toBe(2);
    expect(r.churnReasons).toEqual([{ reason: 'cost', count: 1 }]);
    const june = r.cohorts.find((x) => x.month === '2026-06')!;
    expect(june).toEqual({
      month: '2026-06',
      started: 2,
      retained: [
        { after: 1, percent: 100 },
        { after: 3, percent: 50 },
        { after: 6, percent: null },
      ],
    });
    expect(r.monthly.find((m) => m.month === '2026-08')).toEqual({
      month: '2026-08',
      started: 0,
      ended: 1,
    });
    // a: Jun 10 -> Nov 15 (158 days); b: Jun 20 -> Aug 15 (56); c: Oct 5 -> Nov 15 (41).
    expect(r.medianLifetimeDays).toBe(56);
    expect(r.averageLifetimeDays).toBe(Math.round((158.5 + 56 + 41.5) / 3));

    // Restoring clears the end date and reason.
    await runAs(prisma, org.coach, (tx) =>
      updateClient(tx, org.coach, b.clientId, { status: 'active' }),
    );
    const restored = await withSystem(
      (tx) =>
        tx.client.findUniqueOrThrow({
          where: { id: b.clientId },
          select: { archivedAt: true, churnReason: true },
        }),
      prisma,
    );
    expect(restored).toEqual({ archivedAt: null, churnReason: null });
  });
});
