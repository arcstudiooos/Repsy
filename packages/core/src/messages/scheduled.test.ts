import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';
import { getClientThread, listMessages } from './messages';
import {
  cancelScheduledMessage,
  listScheduledMessages,
  scheduleMessage,
  sendDueScheduledMessages,
} from './scheduled';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('scheduled messages (PRD H5)', () => {
  it('sends at the client-local time, once, as the coach', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // America/New_York
    const s = await runAs(prisma, org.coach, (tx) =>
      scheduleMessage(
        tx,
        org.coach,
        w.clientId,
        { body: 'Morning! Big day.', localDate: '2026-11-05', localTime: '07:30' },
        { now: NOW },
      ),
    );
    expect(s).toMatchObject({
      sendAt: '2026-11-05T12:30:00.000Z',
      localDate: '2026-11-05',
      localTime: '07:30',
      timezone: 'America/New_York',
    });
    expect(
      await runAs(prisma, org.coach, (tx) => listScheduledMessages(tx, org.coach, w.clientId)),
    ).toHaveLength(1);

    // Not due yet.
    expect(await sendDueScheduledMessages(prisma, NOW)).toEqual({ sent: 0, failed: 0 });
    const due = new Date('2026-11-05T12:30:30Z');
    expect(await sendDueScheduledMessages(prisma, due)).toEqual({ sent: 1, failed: 0 });
    expect(await sendDueScheduledMessages(prisma, due)).toEqual({ sent: 0, failed: 0 });
    const thread = await runAs(prisma, w.client, (tx) =>
      tx.conversationThread.findFirstOrThrow({ select: { id: true } }),
    );
    const page = await runAs(prisma, w.client, (tx) => listMessages(tx, w.client, thread.id));
    expect(page.items.map((m) => [m.body, m.senderUserId])).toEqual([
      ['Morning! Big day.', org.coach.userId],
    ]);
    expect(
      await runAs(prisma, org.coach, (tx) => listScheduledMessages(tx, org.coach, w.clientId)),
    ).toEqual([]);
  });

  it('a cancelled message never goes out; past times and clients are refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const s = await runAs(prisma, org.coach, (tx) =>
      scheduleMessage(
        tx,
        org.coach,
        w.clientId,
        { body: 'Later', localDate: '2026-11-06', localTime: '09:00' },
        { now: NOW },
      ),
    );
    await runAs(prisma, org.coach, (tx) => cancelScheduledMessage(tx, org.coach, s.id));
    await expect(
      runAs(prisma, org.coach, (tx) => cancelScheduledMessage(tx, org.coach, s.id)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await sendDueScheduledMessages(prisma, new Date('2026-12-01T00:00:00Z'))).toEqual({
      sent: 0,
      failed: 0,
    });
    await expect(
      runAs(prisma, org.coach, (tx) =>
        scheduleMessage(
          tx,
          org.coach,
          w.clientId,
          { body: 'Too late', localDate: '2026-11-04', localTime: '07:00' },
          { now: NOW },
        ),
      ),
    ).rejects.toMatchObject({ fieldErrors: { sendAt: ['Pick a time in the future.'] } });
    await expect(
      runAs(prisma, w.client, (tx) =>
        scheduleMessage(tx, w.client, w.clientId, {
          body: 'x',
          localDate: '2026-11-06',
          localTime: '09:00',
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The thread exists for the coach; nothing reached it.
    const thread = await runAs(prisma, org.coach, (tx) =>
      getClientThread(tx, org.coach, w.clientId),
    );
    const msgs = await withSystem(
      (tx) => tx.message.count({ where: { threadId: thread.id } }),
      prisma,
    );
    expect(msgs).toBe(0);
  });
});
