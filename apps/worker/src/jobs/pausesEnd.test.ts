import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { endDuePauses } from './pausesEnd';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;
let userId: string;
let seq = 0;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  ({ orgId, userId } = await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'coach@example.test', name: 'Coach' } });
    const org = await tx.organization.create({
      data: { name: 'Org', timezone: 'UTC', ownerUserId: user.id },
    });
    return { orgId: org.id, userId: user.id };
  }, prisma));
});
afterAll(async () => {
  await drop();
});

/** A paused client in `timezone` whose pause resumes on `resume`. */
async function pausedClient(timezone: string, resume: string): Promise<string> {
  seq += 1;
  return withSystem(async (tx) => {
    const client = await tx.client.create({
      data: {
        organizationId: orgId,
        coachUserId: userId,
        name: 'C',
        email: `c${seq}@example.test`,
        status: 'paused',
        timezone,
      },
    });
    await tx.clientPause.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        startLocalDate: new Date('2026-11-20'),
        resumeLocalDate: new Date(resume),
        appliedOffsetDays: 7,
        createdBy: userId,
      },
    });
    return client.id;
  }, prisma);
}

const state = (clientId: string) =>
  withSystem(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
    const pause = await tx.clientPause.findFirstOrThrow({ where: { clientId } });
    const audits = await tx.auditEvent.findMany({
      where: { objectId: clientId, action: 'client.resumed' },
    });
    return { status: client.status, endedAt: pause.endedAt, audits };
  }, prisma);

describe('endDuePauses', () => {
  it('ends due pauses once (run x2) and leaves future ones', async () => {
    // 2026-11-27 03:00 UTC: already the 27th in UTC, still the 26th in Los Angeles.
    const now = new Date('2026-11-27T03:00:00Z');
    const due = await pausedClient('UTC', '2026-11-27');
    const notYet = await pausedClient('America/Los_Angeles', '2026-11-27');
    const later = await pausedClient('UTC', '2026-12-04');

    expect(await endDuePauses(prisma, now)).toEqual({ ended: 1, failed: 0 });
    expect(await endDuePauses(prisma, now)).toEqual({ ended: 0, failed: 0 });

    const ended = await state(due);
    expect(ended.status).toBe('active');
    expect(ended.endedAt?.toISOString()).toBe(now.toISOString());
    expect(ended.audits).toHaveLength(1);
    expect(ended.audits[0]).toMatchObject({ actorId: null, metadataJson: { automatic: true } });
    for (const id of [notYet, later]) {
      expect(await state(id)).toMatchObject({ status: 'paused', endedAt: null, audits: [] });
    }

    // Once Los Angeles reaches the 27th, that pause ends too.
    expect(await endDuePauses(prisma, new Date('2026-11-27T09:00:00Z'))).toEqual({
      ended: 1,
      failed: 0,
    });
    expect((await state(notYet)).status).toBe('active');
  });
});
