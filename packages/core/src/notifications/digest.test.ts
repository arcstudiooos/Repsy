import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { getMyThread, sendMessage } from '../messages/messages';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { queueCoachDigests } from './digest';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const outbox = (orgId: string) =>
  withSystem(
    (tx) =>
      tx.outboxEmail.findMany({
        where: { organizationId: orgId, kind: 'coach_digest' },
        select: { toUserId: true, payloadJson: true },
      }),
    prisma,
  );

describe('coach digest (PRD H14)', () => {
  it('queues one digest a day from 07:00 local for opted-in coaches with something to report', async () => {
    const org = await newOrg(prisma); // New York
    const w = await newClientWorld(prisma, org);
    const run = (iso: string) =>
      runAs(prisma, org.coach, (tx) => queueCoachDigests(tx, org.orgId, new Date(iso)));
    await withSystem(
      (tx) =>
        tx.notificationPreference.upsert({
          where: { userId: org.coach.userId },
          create: { userId: org.coach.userId, digestEmailOptIn: true },
          update: { digestEmailOptIn: true },
        }),
      prisma,
    );
    // Nothing to report yet.
    expect(await run('2026-11-05T13:00:00Z')).toEqual({ queued: 0 });
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Question about Friday' }),
    );
    // 06:00 in New York: too early.
    expect(await run('2026-11-05T11:00:00Z')).toEqual({ queued: 0 });
    expect(await run('2026-11-05T13:00:00Z')).toEqual({ queued: 1 });
    expect(await run('2026-11-05T20:00:00Z')).toEqual({ queued: 0 });
    const [email] = await outbox(org.orgId);
    expect(email).toMatchObject({
      toUserId: org.coach.userId,
      payloadJson: { unread: 1, checkins: 0 },
    });
    // Never names or message text.
    expect(JSON.stringify(email!.payloadJson)).not.toMatch(/Friday|Client/);
    // The next local day gets a new one.
    expect(await run('2026-11-06T13:00:00Z')).toEqual({ queued: 1 });
  });

  it('skips coaches who did not opt in', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) => sendMessage(tx, w.client, thread.id, { body: 'Hi' }));
    expect(
      await runAs(prisma, org.coach, (tx) =>
        queueCoachDigests(tx, org.orgId, new Date('2026-11-05T13:00:00Z')),
      ),
    ).toEqual({ queued: 0 });
  });

  it('reads the opt-in the way the worker runs: no signed-in user', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await withSystem(
      (tx) =>
        tx.notificationPreference.upsert({
          where: { userId: org.coach.userId },
          create: { userId: org.coach.userId, digestEmailOptIn: true },
          update: { digestEmailOptIn: true },
        }),
      prisma,
    );
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) => sendMessage(tx, w.client, thread.id, { body: 'Hi' }));
    expect(
      await withTenant(
        org.orgId,
        (tx) => queueCoachDigests(tx, org.orgId, new Date('2026-11-05T13:00:00Z')),
        prisma,
      ),
    ).toEqual({ queued: 1 });
  });
});
