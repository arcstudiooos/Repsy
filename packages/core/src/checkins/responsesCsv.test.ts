import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { checkinResponsesCsv } from './responsesCsv';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('check-in response export (PRD F12)', () => {
  it('one row per sent check-in, a column per question by first-asked order', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const energy = { id: 'energy', type: 'scale_1_5', label: 'Energy', optional: true };
    const wins = { id: 'wins', type: 'short_text', label: 'Wins', optional: true };
    await withSystem(async (tx) => {
      const t = await tx.checkinTemplate.create({
        data: { organizationId: w.orgId, title: 'Weekly', questionsJson: [energy] },
      });
      const base = { organizationId: w.orgId, clientId: w.clientId, templateId: t.id };
      await tx.checkin.create({
        data: {
          ...base,
          periodLocalDate: new Date('2026-11-04T00:00:00Z'),
          questionsJson: [energy],
          issuedAt: new Date('2026-11-04T11:00:00Z'),
          dueAt: new Date('2026-11-05T04:59:00Z'),
          submittedAt: new Date('2026-11-04T20:00:00Z'),
          answersJson: { energy: 4 },
          submitIdempotencyKey: 'a',
        },
      });
      // A later template edit added a question.
      await tx.checkin.create({
        data: {
          ...base,
          periodLocalDate: new Date('2026-11-11T00:00:00Z'),
          questionsJson: [energy, wins],
          issuedAt: new Date('2026-11-11T11:00:00Z'),
          dueAt: new Date('2026-11-12T04:59:00Z'),
          submittedAt: new Date('2026-11-11T20:00:00Z'),
          answersJson: { energy: 3, wins: '=HYPERLINK("x"), squat PR' },
          submitIdempotencyKey: 'b',
        },
      });
      // Not sent yet: left out.
      await tx.checkin.create({
        data: {
          ...base,
          periodLocalDate: new Date('2026-11-18T00:00:00Z'),
          questionsJson: [energy],
          issuedAt: new Date('2026-11-18T11:00:00Z'),
          dueAt: new Date('2026-11-19T04:59:00Z'),
        },
      });
    }, prisma);
    const { filename, csv } = await runAs(prisma, w.coach, (tx) =>
      checkinResponsesCsv(tx, w.coach, w.clientId),
    );
    expect(filename).toBe('check-ins-client.csv');
    expect(csv.split('\r\n')).toEqual([
      'week_of,sent_at,reviewed_at,Energy,Wins',
      '2026-11-04,2026-11-04T20:00:00.000Z,,4,',
      `2026-11-11,2026-11-11T20:00:00.000Z,,3,"'=HYPERLINK(""x""), squat PR"`,
      '',
    ]);
    await expect(
      runAs(prisma, w.client, (tx) => checkinResponsesCsv(tx, w.client, w.clientId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
