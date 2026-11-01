import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { recordMedia } from '../media/media';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getClientThread, listMessages, sendMessage } from './messages';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('message attachments (PRD H2)', () => {
  it('a photo or PDF goes with a message (or alone); someone else’s file is refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const thread = await runAs(prisma, org.coach, (tx) =>
      getClientThread(tx, org.coach, w.clientId),
    );
    const upload = (actor: typeof w.client, clientId: string, key: string) =>
      runAs(prisma, actor, (tx) =>
        recordMedia(tx, actor, {
          purpose: 'message',
          clientId,
          contentType: 'application/pdf',
          bytes: 10,
          key: `media/${org.orgId}/message/${key}`,
        }),
      );
    const pdf = await upload(w.client, w.clientId, 'a');
    const sent = await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: '', attachmentMediaId: pdf.id }),
    );
    expect(sent.attachment).toEqual({ mediaId: pdf.id, contentType: 'application/pdf' });
    const page = await runAs(prisma, org.coach, (tx) => listMessages(tx, org.coach, thread.id));
    expect(page.items.at(-1)?.attachment?.mediaId).toBe(pdf.id);

    const theirs = await upload(other.client, other.clientId, 'b');
    await expect(
      runAs(prisma, w.client, (tx) =>
        sendMessage(tx, w.client, thread.id, { body: 'x', attachmentMediaId: theirs.id }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      runAs(prisma, w.client, (tx) => sendMessage(tx, w.client, thread.id, { body: '' })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
