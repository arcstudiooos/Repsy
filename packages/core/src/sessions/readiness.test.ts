import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { getSessionDetail } from './detail';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from './fixtures.test-helpers';
import { completeSession } from './lifecycle';
import { recordReadiness } from './readiness';
import { readinessScore } from './readiness-questions';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const all = (n: number) => ({ sleep: n, energy: n, soreness: n, stress: n, mood: n });

describe('readiness check (PRD D17)', () => {
  it('scores 0 to 100', () => {
    expect(readinessScore(all(1))).toBe(0);
    expect(readinessScore(all(5))).toBe(100);
    expect(readinessScore({ sleep: 4, energy: 3, soreness: 2, stress: 5, mood: 4 })).toBe(65);
  });

  it('the client answers before Start; the coach sees it; finished workouts are closed', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const [first] = await sessionsOf(prisma, w.assignmentId);
    const id = first!.id;
    await expect(
      runAs(prisma, w.client, (tx) => recordReadiness(tx, w.client, id, { ...all(3), mood: 6 })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      runAs(prisma, org.coach, (tx) => recordReadiness(tx, org.coach, id, all(3))),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const saved = await runAs(prisma, w.client, (tx) =>
      recordReadiness(
        tx,
        w.client,
        id,
        { sleep: 4, energy: 3, soreness: 2, stress: 5, mood: 4 },
        { now: NOW },
      ),
    );
    expect(saved.score).toBe(65);
    const detail = await runAs(prisma, org.coach, (tx) =>
      getSessionDetail(tx, org.coach, id, { now: NOW }),
    );
    expect(detail.readiness).toMatchObject({ score: 65, answers: { sleep: 4, soreness: 2 } });
    expect(detail.session.readinessScore).toBe(65);

    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, id, { idempotencyKey: crypto.randomUUID() }, { now: NOW }),
    );
    await expect(
      runAs(prisma, w.client, (tx) => recordReadiness(tx, w.client, id, all(5))),
    ).rejects.toMatchObject({ code: 'SESSION_FINISHED' });
  });
});
