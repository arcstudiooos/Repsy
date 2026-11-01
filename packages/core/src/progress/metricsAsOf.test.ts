import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { metricsAsOf } from './metricsAsOf';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('metrics as of a date (PRD F6)', () => {
  it('returns the latest value of each measurement on or before each date', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await withSystem(async (tx) => {
      const base = {
        organizationId: w.orgId,
        clientId: w.clientId,
        source: 'coach' as const,
        recordedByUserId: w.coach.userId,
      };
      await tx.metricEntry.create({
        data: {
          ...base,
          metric: 'weight',
          measuredOn: new Date('2026-10-01T00:00:00Z'),
          value: 82,
        },
      });
      await tx.metricEntry.create({
        data: {
          ...base,
          metric: 'weight',
          measuredOn: new Date('2026-10-20T00:00:00Z'),
          value: 80,
        },
      });
      await tx.metricEntry.create({
        data: { ...base, metric: 'waist', measuredOn: new Date('2026-10-15T00:00:00Z'), value: 90 },
      });
    }, prisma);
    const res = await runAs(prisma, w.coach, (tx) =>
      metricsAsOf(tx, w.coach, w.clientId, ['2026-09-30', '2026-10-10', '2026-10-25']),
    );
    expect(res['2026-09-30']).toEqual([]);
    expect(res['2026-10-10']).toEqual([{ metric: 'weight', value: 82, measuredOn: '2026-10-01' }]);
    expect(res['2026-10-25']).toEqual(
      expect.arrayContaining([
        { metric: 'weight', value: 80, measuredOn: '2026-10-20' },
        { metric: 'waist', value: 90, measuredOn: '2026-10-15' },
      ]),
    );
  });
});
