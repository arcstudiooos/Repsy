import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { listClients } from '../clients/clients';
import { getMyThread, sendMessage } from '../messages/messages';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';
import { cancelCover, coverForClient, createCover } from './cover';
import { defaultScope, scopeCoachIds, transferClient } from './scope';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

async function teammate(orgId: string, role: 'coach' | 'assistant' | 'admin', name: string) {
  const user = await withSystem(
    (tx) =>
      tx.user.create({
        data: { email: `${name}-${Date.now()}-${Math.random()}@example.test`, name },
      }),
    prisma,
  );
  await withSystem(
    (tx) => tx.membership.create({ data: { userId: user.id, organizationId: orgId, role } }),
    prisma,
  );
  return { userId: user.id, orgId, role, isPlatformAdmin: false } as ActorContext;
}

describe('primary coach, my clients and cover (PRD A11-A13)', () => {
  it('coaches see their own clients by default; a transfer moves the client and the thread', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const bea = await teammate(org.orgId, 'coach', 'Bea');
    expect(defaultScope('coach')).toBe('mine');
    expect(defaultScope('admin')).toBe('all');
    const mine = (a: ActorContext) =>
      runAs(prisma, a, async (tx) =>
        (
          await listClients(tx, a, {
            coachUserIds: (await scopeCoachIds(tx, a, 'mine')) ?? undefined,
          })
        ).items.map((c) => c.id),
      );
    expect(await mine(org.coach)).toEqual([w.clientId]);
    expect(await mine(bea)).toEqual([]);
    // Bea can't take someone else's client; the owner can hand it to her.
    await expect(
      runAs(prisma, bea, (tx) => transferClient(tx, bea, w.clientId, bea.userId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runAs(prisma, org.coach, (tx) => transferClient(tx, org.coach, w.clientId, bea.userId));
    expect(await mine(bea)).toEqual([w.clientId]);
    const thread = await withSystem(
      (tx) => tx.conversationThread.findFirst({ where: { clientId: w.clientId } }),
      prisma,
    );
    if (thread) expect(thread.coachUserId).toBe(bea.userId);
    // Assistants can't be primary coaches.
    const ann = await teammate(org.orgId, 'assistant', 'Ann');
    await expect(
      runAs(prisma, org.coach, (tx) => transferClient(tx, org.coach, w.clientId, ann.userId)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('cover adds the away coach’s clients to "mine", routes client messages, and ends', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const cal = await teammate(org.orgId, 'coach', 'Cal');
    const cover = await runAs(prisma, org.coach, (tx) =>
      createCover(
        tx,
        org.coach,
        { coverUserId: cal.userId, startDate: '2026-11-04', endDate: '2026-11-10' },
        { now: NOW },
      ),
    );
    expect(cover).toMatchObject({ coachName: 'Coach', coverName: 'Cal' });
    const ids = await runAs(prisma, cal, (tx) => scopeCoachIds(tx, cal, 'mine', NOW));
    expect(ids).toEqual([cal.userId, org.coach.userId]);
    expect(await runAs(prisma, w.client, (tx) => coverForClient(tx, w.clientId, NOW))).toEqual({
      coachName: 'Coach',
      coverName: 'Cal',
      until: '2026-11-10',
    });
    // A client message during cover notifies the covering coach.
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await withSystem(
      (tx) =>
        tx.notificationPreference.upsert({
          where: { userId: cal.userId },
          create: { userId: cal.userId, messageEmailOptIn: true },
          update: { messageEmailOptIn: true },
        }),
      prisma,
    );
    await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Hi Cal' }, { now: NOW }),
    );
    const mail = await withSystem(
      (tx) => tx.outboxEmail.findMany({ where: { kind: 'new_message', toUserId: cal.userId } }),
      prisma,
    );
    expect(mail).toHaveLength(1);
    await runAs(prisma, org.coach, (tx) => cancelCover(tx, org.coach, cover.id));
    expect(await runAs(prisma, cal, (tx) => scopeCoachIds(tx, cal, 'mine', NOW))).toEqual([
      cal.userId,
    ]);
  });
});
