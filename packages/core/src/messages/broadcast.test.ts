import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createTag, setClientTags } from '../clients/tags';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { broadcastAudiences, broadcastMessage } from './broadcast';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const messagesOf = (clientId: string) =>
  withSystem(
    (tx) =>
      tx.message.findMany({
        where: { thread: { is: { clientId } } },
        select: { body: true, senderUserId: true },
      }),
    prisma,
  );

describe('broadcast (PRD H6)', () => {
  it('sends individual messages to everyone or a tag, once per idempotency key', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const tag = await runAs(prisma, org.coach, (tx) =>
      createTag(tx, org.coach, { name: 'Online' }),
    );
    await runAs(prisma, org.coach, (tx) => setClientTags(tx, org.coach, a.clientId, [tag.id]));
    expect(await runAs(prisma, org.coach, (tx) => broadcastAudiences(tx, org.coach))).toEqual([
      { key: 'all', label: 'All active clients', count: 2 },
      { key: tag.id, label: 'Tag: Online', count: 1 },
    ]);

    const key = randomUUID();
    expect(
      await runAs(prisma, org.coach, (tx) =>
        broadcastMessage(tx, org.coach, {
          audience: 'all',
          body: 'Gym closed Monday',
          idempotencyKey: key,
        }),
      ),
    ).toEqual({ sent: 2 });
    // A retry with the same key adds nothing.
    await runAs(prisma, org.coach, (tx) =>
      broadcastMessage(tx, org.coach, {
        audience: 'all',
        body: 'Gym closed Monday',
        idempotencyKey: key,
      }),
    );
    expect(await messagesOf(a.clientId)).toEqual([
      { body: 'Gym closed Monday', senderUserId: org.coach.userId },
    ]);
    expect(await messagesOf(b.clientId)).toHaveLength(1);

    await runAs(prisma, org.coach, (tx) =>
      broadcastMessage(tx, org.coach, {
        audience: tag.id,
        body: 'Online group call at 6',
        idempotencyKey: randomUUID(),
      }),
    );
    expect((await messagesOf(a.clientId)).map((m) => m.body)).toContain('Online group call at 6');
    expect((await messagesOf(b.clientId)).map((m) => m.body)).not.toContain(
      'Online group call at 6',
    );

    await expect(
      runAs(prisma, a.client, (tx) =>
        broadcastMessage(tx, a.client, {
          audience: 'all',
          body: 'hi',
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      runAs(prisma, org.coach, (tx) =>
        broadcastMessage(tx, org.coach, {
          audience: 'all',
          body: '  ',
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('sends to selected clients only (PRD B5)', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    expect(
      await runAs(prisma, org.coach, (tx) =>
        broadcastMessage(tx, org.coach, {
          audience: 'selected',
          clientIds: [b.clientId],
          body: 'Just you',
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toEqual({ sent: 1 });
    expect((await messagesOf(a.clientId)).map((m) => m.body)).toEqual([]);
    expect((await messagesOf(b.clientId)).map((m) => m.body)).toEqual(['Just you']);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        broadcastMessage(tx, org.coach, {
          audience: 'selected',
          clientIds: [],
          body: 'x',
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
