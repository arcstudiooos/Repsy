import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { parseAnchorRef } from './anchors';
import { getClientThread, listMessages, sendMessage } from './messages';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('anchored messages (PRD H3)', () => {
  it('a message about a workout carries its label; another client’s workout is refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const [session] = await sessionsOf(prisma, w.assignmentId);
    const [theirs] = await sessionsOf(prisma, other.assignmentId);
    const thread = await runAs(prisma, org.coach, (tx) =>
      getClientThread(tx, org.coach, w.clientId),
    );
    const sent = await runAs(prisma, org.coach, (tx) =>
      sendMessage(tx, org.coach, thread.id, {
        body: 'Nice work on this one',
        anchor: { type: 'session', id: session!.id },
      }),
    );
    // The fixture's first workout is "W1D1" on Wed 4 Nov 2026.
    expect(sent.anchor).toEqual({ type: 'session', id: session!.id, label: 'W1D1, Wed 4 Nov' });
    const page = await runAs(prisma, w.client, (tx) => listMessages(tx, w.client, thread.id));
    expect(page.items[0]?.anchor?.label).toBe('W1D1, Wed 4 Nov');
    await expect(
      runAs(prisma, org.coach, (tx) =>
        sendMessage(tx, org.coach, thread.id, {
          body: 'Wrong one',
          anchor: { type: 'session', id: theirs!.id },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { anchor: expect.any(Array) } });
    await expect(
      runAs(prisma, w.client, (tx) =>
        sendMessage(tx, w.client, thread.id, {
          body: 'x',
          anchor: { type: 'photo', id: session!.id },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('reads anchor references from links', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseAnchorRef(`session:${id}`)).toEqual({ type: 'session', id });
    expect(parseAnchorRef(`checkin:${id}`)).toEqual({ type: 'checkin', id });
    expect(parseAnchorRef('photo:x')).toBeNull();
    expect(parseAnchorRef(undefined)).toBeNull();
  });
});
