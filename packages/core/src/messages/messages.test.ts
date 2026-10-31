import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import {
  getClientThread,
  getMyThread,
  listMessages,
  listThreads,
  sendMessage,
  unreadMessageCount,
} from './messages';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

const world = async () => newClientWorld(prisma, await newOrg(prisma));
const myThread = (w: ClientWorld) => runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
const send = (
  w: ClientWorld,
  as: 'coach' | 'client',
  threadId: string,
  body: string,
  key?: string,
) => {
  const actor = as === 'coach' ? w.coach : w.client;
  return runAs(prisma, actor, (tx) =>
    sendMessage(tx, actor, threadId, { body, clientMessageId: key }),
  );
};

describe('messages', () => {
  it('one thread per client; coach and client open the same one', async () => {
    const w = await world();
    const a = await myThread(w);
    const b = await runAs(prisma, w.coach, (tx) => getClientThread(tx, w.coach, w.clientId));
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ canPost: true, unread: 0, lastMessage: null });
  });

  it('pagination boundary: 31 messages → 2 pages, newest first, no dupes', async () => {
    const w = await world();
    const { id } = await myThread(w);
    await withSystem(async (tx) => {
      const t0 = Date.parse('2026-11-04T10:00:00Z');
      await tx.message.createMany({
        data: Array.from({ length: 31 }, (_, i) => ({
          organizationId: w.orgId,
          threadId: id,
          senderUserId: w.coach.userId,
          body: `m${i}`,
          // Two share a timestamp: the id breaks the tie.
          createdAt: new Date(t0 + Math.min(i, 30) * 1000 - (i === 30 ? 1000 : 0)),
        })),
      });
    }, prisma);
    const first = await runAs(prisma, w.client, (tx) => listMessages(tx, w.client, id));
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await runAs(prisma, w.client, (tx) =>
      listMessages(tx, w.client, id, { cursor: first.nextCursor! }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((m) => m.body);
    expect(new Set(all).size).toBe(31);
    // m29 and m30 share a timestamp: the id decides which comes first.
    expect(['m29', 'm30']).toContain(first.items[0]?.body);
  });

  it('read when the recipient views the thread; unread counts per side', async () => {
    const w = await world();
    const { id } = await myThread(w);
    await send(w, 'coach', id, 'How did it go?');
    expect(await runAs(prisma, w.client, (tx) => unreadMessageCount(tx, w.client))).toBe(1);
    // The sender listing the thread marks nothing.
    await runAs(prisma, w.coach, (tx) => listMessages(tx, w.coach, id));
    expect(await runAs(prisma, w.client, (tx) => unreadMessageCount(tx, w.client))).toBe(1);
    const page = await runAs(prisma, w.client, (tx) => listMessages(tx, w.client, id));
    expect(page.items[0]).toMatchObject({ mine: false, body: 'How did it go?' });
    expect(await runAs(prisma, w.client, (tx) => unreadMessageCount(tx, w.client))).toBe(0);
    const coachView = await runAs(prisma, w.coach, (tx) => listMessages(tx, w.coach, id));
    expect(coachView.items[0]?.readAt).not.toBeNull();

    await send(w, 'client', id, 'Good, thanks');
    const inbox = await runAs(prisma, w.coach, (tx) => listThreads(tx, w.coach));
    expect(inbox[0]).toMatchObject({
      id,
      unread: 1,
      lastMessage: { body: 'Good, thanks', mine: false },
    });
  });

  it('a retried send with the same clientMessageId stores one message', async () => {
    const w = await world();
    const { id } = await myThread(w);
    const key = crypto.randomUUID();
    const a = await send(w, 'client', id, 'Hello', key);
    const b = await send(w, 'client', id, 'Hello', key);
    expect(b.id).toBe(a.id);
    expect(await withSystem((tx) => tx.message.count({ where: { threadId: id } }), prisma)).toBe(1);
  });

  it('validates the body; archived clients cannot post; messages are immutable', async () => {
    const w = await world();
    const { id } = await myThread(w);
    expect(await codeOf(send(w, 'client', id, '   '))).toBe('VALIDATION');
    expect(await codeOf(send(w, 'client', id, 'x'.repeat(4001)))).toBe('VALIDATION');
    const m = await send(w, 'client', id, 'x'.repeat(4000));
    await expect(
      withSystem(
        (tx) => tx.message.update({ where: { id: m.id }, data: { body: 'edited' } }),
        prisma,
      ),
    ).rejects.toThrow(/immutable/);

    await withSystem(
      (tx) => tx.client.update({ where: { id: w.clientId }, data: { status: 'archived' } }),
      prisma,
    );
    expect(await codeOf(send(w, 'coach', id, 'Still there?'))).toBe('CONFLICT');
    const view = await runAs(prisma, w.coach, (tx) => getClientThread(tx, w.coach, w.clientId));
    expect(view.canPost).toBe(false);
  });

  it('the body never reaches the audit log or the email; email only on opt-in', async () => {
    const w = await world();
    const { id } = await myThread(w);
    const secret = 'my knee hurts';
    await send(w, 'client', id, secret);
    expect(
      await withSystem(
        (tx) => tx.outboxEmail.count({ where: { organizationId: w.orgId, kind: 'new_message' } }),
        prisma,
      ),
    ).toBe(0);
    await withSystem(
      (tx) =>
        tx.notificationPreference.create({
          data: { userId: w.coach.userId, messageEmailOptIn: true },
        }),
      prisma,
    );
    const m = await send(w, 'client', id, secret);
    const [email] = await withSystem(
      (tx) => tx.outboxEmail.findMany({ where: { organizationId: w.orgId, kind: 'new_message' } }),
      prisma,
    );
    expect(email).toMatchObject({
      toUserId: w.coach.userId,
      idempotencyKey: `new-message:${m.id}`,
    });
    expect(JSON.stringify(email?.payloadJson)).not.toContain(secret);
    const audits = await withSystem(
      (tx) =>
        tx.auditEvent.findMany({ where: { organizationId: w.orgId, action: 'message.sent' } }),
      prisma,
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(secret);
  });

  it('other org and sibling clients → NOT_FOUND; clients cannot list the inbox', async () => {
    const w = await world();
    const { id } = await myThread(w);
    const sibling = await newClientWorld(prisma, { orgId: w.orgId, coach: w.coach });
    expect(
      await codeOf(runAs(prisma, sibling.client, (tx) => listMessages(tx, sibling.client, id))),
    ).toBe('NOT_FOUND');
    expect(await codeOf(send(sibling, 'client', id, 'hi'))).toBe('NOT_FOUND');
    const other = await newOrg(prisma);
    expect(
      await codeOf(runAs(prisma, other.coach, (tx) => listMessages(tx, other.coach, id))),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) => getClientThread(tx, other.coach, w.clientId)),
      ),
    ).toBe('NOT_FOUND');
    expect(await codeOf(runAs(prisma, w.client, (tx) => listThreads(tx, w.client)))).toBe(
      'FORBIDDEN',
    );
  });
});
