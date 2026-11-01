import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';
import { fillPlaceholders } from './fill';
import { replyFacts } from './replyFacts';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('reply placeholders (PRD F7)', () => {
  it('fills known tokens and leaves the rest', () => {
    expect(
      fillPlaceholders('Hi {first_name}, {weight} today. {unknown}', {
        first_name: 'Ana',
        weight: '79 kg',
      }),
    ).toBe('Hi Ana, 79 kg today. {unknown}');
  });

  it('collects this week, weight and the next workout from recorded data', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // Mon/Wed/Fri from Wed 4 Nov: 4 and 6 Nov this week
    await withSystem(
      (tx) => tx.client.update({ where: { id: w.clientId }, data: { name: 'Ana Silva' } }),
      prisma,
    );
    await withSystem(
      (tx) =>
        tx.metricEntry.create({
          data: {
            organizationId: w.orgId,
            clientId: w.clientId,
            metric: 'weight',
            measuredOn: new Date('2026-11-03T00:00:00Z'),
            value: 80,
            source: 'coach',
            recordedByUserId: w.coach.userId,
          },
        }),
      prisma,
    );
    const facts = await runAs(prisma, org.coach, (tx) =>
      replyFacts(tx, org.coach, w.clientId, 'lb', { now: NOW }),
    );
    expect(facts).toEqual({
      first_name: 'Ana',
      workouts_planned: '2',
      workouts_done: '0',
      weight: '176.4 lb',
      next_workout: 'Wednesday 4 Nov',
    });
  });
});
