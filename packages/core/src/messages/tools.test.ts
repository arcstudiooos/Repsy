import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  createSavedReply,
  deleteSavedReply,
  fillSavedReply,
  getReplyExpectations,
  listSavedReplies,
  updateReplyExpectations,
} from './tools';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('messaging tools (PRD H4, H16)', () => {
  it('fills the first name', () => {
    expect(fillSavedReply('Great work {first_name}! See you {first_name}.', 'Ada Lovelace')).toBe(
      'Great work Ada! See you Ada.',
    );
  });

  it('owner sets reply expectations; the client reads them', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    expect(await runAs(prisma, w.client, (tx) => getReplyExpectations(tx, w.client))).toEqual({
      replyTargetHours: null,
      officeHours: null,
    });
    await runAs(prisma, w.coach, (tx) =>
      updateReplyExpectations(tx, w.coach, { replyTargetHours: 24, officeHours: ' Mon-Fri 8-18 ' }),
    );
    expect(await runAs(prisma, w.client, (tx) => getReplyExpectations(tx, w.client))).toEqual({
      replyTargetHours: 24,
      officeHours: 'Mon-Fri 8-18',
    });
    await expect(
      runAs(prisma, w.coach, (tx) => updateReplyExpectations(tx, w.coach, { replyTargetHours: 5 })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      runAs(prisma, w.client, (tx) => updateReplyExpectations(tx, w.client, { officeHours: 'x' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('coaches share saved replies; clients never see them; other orgs cannot delete', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newOrg(prisma);
    const r = await runAs(prisma, w.coach, (tx) =>
      createSavedReply(tx, w.coach, { title: 'Great week', body: 'Great week {first_name}!' }),
    );
    expect(await runAs(prisma, w.coach, (tx) => listSavedReplies(tx, w.coach))).toEqual([r]);
    await expect(
      runAs(prisma, w.client, (tx) => listSavedReplies(tx, w.client)),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      runAs(prisma, other.coach, (tx) => deleteSavedReply(tx, other.coach, r.id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, w.coach, (tx) => createSavedReply(tx, w.coach, { title: '', body: 'x' })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await runAs(prisma, w.coach, (tx) => deleteSavedReply(tx, w.coach, r.id));
    expect(await runAs(prisma, w.coach, (tx) => listSavedReplies(tx, w.coach))).toEqual([]);
  });
});
