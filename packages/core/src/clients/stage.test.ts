import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { completeSession } from '../sessions/lifecycle';
import { getClient, listClients } from './clients';
import { setLifecycleStage } from './stage';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('client lifecycle stage (PRD B20)', () => {
  it('starts at onboarding, moves to active on the first completed workout, and filters', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const stageOf = async (id: string) =>
      (await runAs(prisma, org.coach, (tx) => getClient(tx, org.coach, id))).lifecycleStage;
    expect(await stageOf(w.clientId)).toBe('onboarding');
    const [s] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, s!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
    );
    expect(await stageOf(w.clientId)).toBe('active');

    await runAs(prisma, org.coach, (tx) =>
      setLifecycleStage(tx, org.coach, other.clientId, 'at_renewal'),
    );
    const renewing = await runAs(prisma, org.coach, (tx) =>
      listClients(tx, org.coach, { stage: 'at_renewal' }),
    );
    expect(renewing.items.map((c) => c.id)).toEqual([other.clientId]);
    await expect(
      runAs(prisma, org.coach, (tx) => setLifecycleStage(tx, org.coach, other.clientId, 'alumni')),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Archived clients read as alumni whatever was stored.
    await withSystem(
      (tx) => tx.client.update({ where: { id: other.clientId }, data: { status: 'archived' } }),
      prisma,
    );
    expect(await stageOf(other.clientId)).toBe('alumni');
    const alumni = await runAs(prisma, org.coach, (tx) =>
      listClients(tx, org.coach, { stage: 'alumni' }),
    );
    expect(alumni.items.map((c) => c.id)).toEqual([other.clientId]);
    await expect(
      runAs(prisma, org.coach, (tx) => setLifecycleStage(tx, org.coach, other.clientId, 'active')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
